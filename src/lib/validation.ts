import { z } from 'zod'

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Email is required.')
  .email('Please enter a valid email address.')

export const otpSchema = z.string().regex(/^\d{6}$/, 'Enter a valid 6-digit code.')
