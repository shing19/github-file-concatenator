// @/lib/utils.ts

import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const defaultBlacklist = [
  "node_modules/",
  ".git/",
  "dist/",
  "build/",
  ".next/",
  "public/",
  "*.test.*",
  "*.spec.*",
  "*.min.*",
  "*.map",
  "*.lock",
  "package-lock.json",
  "yarn.lock",
  "README.md",
  "LICENSE",
  ".gitignore",
  ".env*",
  "*.log",
  "*.svg",
  "*.png",
  "*.jpg",
  "*.jpeg",
  "*.gif",
  "*.ico",
  "requirements.txt",
  "PRIVACY.md",
  "pnpm-lock.yaml", 
  "**/components/ui/**",
];