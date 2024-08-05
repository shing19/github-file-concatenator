// @app/page.tsx

"use client"

import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import styles from '../styles/Home.module.css'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { defaultBlacklist } from '@/lib/utils'

const githubApi = axios.create({
  baseURL: 'https://api.github.com',
});

// 添加响应拦截器来处理速率限制
githubApi.interceptors.response.use(
  (response) => {
    console.log(`Remaining requests: ${response.headers['x-ratelimit-remaining']}`);
    console.log(`Rate limit resets at: ${new Date(response.headers['x-ratelimit-reset'] * 1000)}`);
    return response;
  },
  (error) => {
    if (error.response && (error.response.status === 403 || error.response.status === 429)) {
      const retryAfter = error.response.headers['retry-after'];
      if (retryAfter) {
        console.log(`Rate limited. Retry after ${retryAfter} seconds`);
      } else {
        console.log('Rate limited. Waiting for 60 seconds before retrying.');
      }
    }
    return Promise.reject(error);
  }
);

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export default function Home() {
  const [repoUrl, setRepoUrl] = useState('')
  const [blacklist, setBlacklist] = useState(defaultBlacklist.join('\n'))
  const [whitelist, setWhitelist] = useState('')
  const [mode, setMode] = useState('minimal')
  const [output, setOutput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState('')
  const blacklistRef = useRef(null)
  const whitelistRef = useRef(null)
  const handleSubmit = async (e) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')
    setOutput('')
    setProgress('')

    const urlParts = repoUrl.replace(/\.git$/, '').split('/')
    const owner = urlParts[urlParts.length - 2]
    const repo = urlParts[urlParts.length - 1]

    let retryCount = 0
    const maxRetries = 3

    while (retryCount < maxRetries) {
      try {
        setProgress('Fetching repository information...')
        console.log(`Fetching repo info for ${owner}/${repo}`)

        const repoResponse = await githubApi.get(`/repos/${owner}/${repo}`)
        await delay(1000); // 等待1秒

        const defaultBranch = repoResponse.data.default_branch
        console.log(`Default branch: ${defaultBranch}`)

        setProgress('Fetching file tree...')
        const treeResponse = await githubApi.get(`/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`)
        await delay(1000); // 等待1秒

        const tree = treeResponse.data.tree
        console.log(`File tree fetched, ${tree.length} items found`)

        const blacklistPatterns = blacklist.split('\n').map(item => item.trim()).filter(Boolean)
        const whitelistPatterns = whitelist.split('\n').map(item => item.trim()).filter(Boolean)

        const isMatch = (path, patterns) => {
          return patterns.some(pattern => {
            // 将模式转换为正则表达式
            const regexPattern = pattern
              .replace(/\*/g, '.*')  // 将 * 转换为 .*
              .replace(/\?/g, '.')   // 将 ? 转换为 .
              .replace(/\//g, '\\/') // 将 / 转义
            const regex = new RegExp(`^${regexPattern}$`)

            // 如果模式以 / 结束，认为它匹配该目录及其所有子目录/文件
            if (pattern.endsWith('/')) {
              return regex.test(path) || path.startsWith(pattern)
            } else {
              return regex.test(path)
            }
          })
        }

        const filesToProcess = tree.filter(item => {
          if (mode === 'minimal') {
            return item.type === 'blob' &&
              isMatch(item.path, whitelistPatterns) &&
              !isMatch(item.path, blacklistPatterns);
          } else {
            return item.type === 'blob' && !isMatch(item.path, blacklistPatterns);
          }
        });

        console.log(`Files to process: ${filesToProcess.length}`)

        // 超过60个文件时，发出警告（后面可以通过更长的时间或者认证来处理）
        if (filesToProcess.length > 60) {
          setError('Too many files to process. Please use a more specific whitelist or blacklist.');
          setIsLoading(false);
          return;
        }

        let concatenatedContent = ''

        for (let i = 0; i < filesToProcess.length; i++) {
          const file = filesToProcess[i]
          setProgress(`Processing file ${i + 1} of ${filesToProcess.length}: ${file.path}`)

          let retryCount = 0
          let fileContent = null
          let lastError = null

          while (retryCount < 3 && !fileContent) {
            try {
              const fileResponse = await githubApi.get(`/repos/${owner}/${repo}/contents/${file.path}`, {
                headers: { 'Accept': 'application/vnd.github.v3.raw' }
              })
              await delay(1000); // 等待1秒

              fileContent = fileResponse.data
            } catch (fileError) {
              console.error(`Error fetching ${file.path} (Attempt ${retryCount + 1}):`, fileError)
              lastError = fileError
              retryCount++

              if (fileError.response && (fileError.response.status === 403 || fileError.response.status === 429)) {
                const retryAfter = fileError.response.headers['retry-after'] || 60;
                await delay(retryAfter * 1000);
              } else {
                await delay(5000); // 其他错误等待5秒后重试
              }
            }
          }

          if (fileContent) {
            concatenatedContent += `// ${file.path}\n${fileContent}\n\n`
          } else {
            console.error(`Failed to fetch ${file.path} after 3 attempts. Last error:`, lastError)
            concatenatedContent += `// Error fetching ${file.path} after 3 attempts. Last error: ${lastError.message}\n\n`
          }
        }

        console.log('All files processed')
        setOutput(concatenatedContent)
        break; // 如果成功，跳出重试循环
      } catch (error) {
        console.error('Error:', error)
        retryCount++
        if (error.response && (error.response.status === 403 || error.response.status === 429)) {
          const retryAfter = error.response.headers['retry-after'] || 60;
          setProgress(`API rate limit exceeded. Waiting ${retryAfter} seconds before retry ${retryCount}...`);
          await delay(retryAfter * 1000);
        } else {
          setProgress(`Error occurred. Retrying in 5 seconds... (Attempt ${retryCount} of ${maxRetries})`);
          await delay(5000);
        }

        if (retryCount === maxRetries) {
          setError(`Failed after ${maxRetries} attempts. Last error: ${error.message}`);
        }
      }
    }

    setIsLoading(false)
    setProgress('')
  }

  const copyToClipboard = () => {
    navigator.clipboard.writeText(output)
  }

  const downloadOutput = () => {
    const blob = new Blob([output], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'concatenated_files.txt'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const adjustTextareaHeight = (textarea) => {
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${textarea.scrollHeight}px`
    }
  }

  useEffect(() => {
    adjustTextareaHeight(blacklistRef.current)
  }, [blacklist])

  useEffect(() => {
    adjustTextareaHeight(whitelistRef.current)
  }, [whitelist])

  const handleBlacklistChange = (e) => {
    setBlacklist(e.target.value)
    adjustTextareaHeight(e.target)
  }

  const handleWhitelistChange = (e) => {
    setWhitelist(e.target.value)
    adjustTextareaHeight(e.target)
  }

  return (
    <div className={styles.container}>
      <h1 className='font-heading mt-12 scroll-m-20 border-b pb-2 text-2xl font-semibold tracking-tight first:mt-0'>GitHub File Concatenator</h1>
      <form onSubmit={handleSubmit} className={styles.form}>
        <Input
          type="text"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          placeholder="GitHub Repository URL"
          className={styles.input}
        />
        <Textarea
          ref={blacklistRef}
          value={blacklist}
          onChange={handleBlacklistChange}
          placeholder="Blacklist (one file per line)"
          className={styles.textarea}
        />
        <Textarea
          ref={whitelistRef}
          value={whitelist}
          onChange={handleWhitelistChange}
          placeholder="Whitelist (one file per line)"
          className={styles.textarea}
        />
        <Select
          value={mode}
          onValueChange={setMode}
        >
          <SelectTrigger>
            <SelectValue placeholder="Mode" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="minimal">Minimal (Whitelist only)</SelectItem>
            <SelectItem value="full">Full (Excluding Blacklist)</SelectItem>
          </SelectContent>
        </Select>
        <Button type="submit" className={styles.button} disabled={isLoading}>
          {isLoading ? 'Generating...' : 'Generate'}
        </Button>
      </form>
      {isLoading && <p>{progress}</p>}
      {error && <p className={styles.error}>{error}</p>}
      {output && (
        <div>
          <pre className="mt-8 border border-gray-300 rounded-md p-4 whitespace-pre-wrap overflow-auto max-h-[500px] text-sm bg-gray-50 dark:bg-gray-800 dark:border-gray-700">
            <code>{output}</code>
          </pre>
          <div className='flex flex-row gap-2 justify-end mt-2'>
            <Button onClick={copyToClipboard} className={styles.button}>Copy to Clipboard</Button>
            <Button onClick={downloadOutput} className={styles.button}>Download</Button>
          </div>
        </div>
      )}
    </div>
  )
}