import { forwardRef, type InputHTMLAttributes } from 'react'
import styles from './Input.module.scss'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  className?: string
}

function joinClasses(...classes: Array<string | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={joinClasses(styles.input, className)} {...props} />
})
