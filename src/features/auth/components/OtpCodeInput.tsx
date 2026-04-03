import { useRef, useState, type ChangeEvent } from 'react'
import styles from './AuthForm.module.scss'

const OTP_LENGTH = 6

interface OtpCodeInputProps {
  id: string
  value: string
  disabled?: boolean
  onChange: (nextValue: string) => void
}

function normalizeOtp(value: string): string {
  return value.replace(/\D/g, '').slice(0, OTP_LENGTH)
}

export function OtpCodeInput({ id, value, disabled, onChange }: OtpCodeInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [isFocused, setIsFocused] = useState(false)
  const otp = normalizeOtp(value)

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(normalizeOtp(event.target.value))
  }

  const focusInput = () => {
    if (disabled || !inputRef.current) return
    inputRef.current.focus()
    const cursorIndex = otp.length
    inputRef.current.setSelectionRange(cursorIndex, cursorIndex)
  }

  const activeIndex = otp.length >= OTP_LENGTH ? OTP_LENGTH - 1 : otp.length

  return (
    <div className={styles.otpContainer} onClick={focusInput}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        className={styles.otpNativeInput}
        value={otp}
        maxLength={OTP_LENGTH}
        disabled={disabled}
        onChange={handleChange}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
      />

      <div className={styles.otpSlots} aria-hidden="true">
        {Array.from({ length: OTP_LENGTH }).map((_, index) => {
          const digit = otp[index] ?? ''
          const isFilled = digit.length > 0
          const isActive = !disabled && index === activeIndex
          const showCaret = isFocused && isActive && !isFilled

          return (
            <span
              key={index}
              className={`${styles.otpSlot} ${isFilled ? styles.otpSlotFilled : ''} ${isActive ? styles.otpSlotActive : ''}`}
            >
              {digit}
              {showCaret ? <span className={styles.otpCaret} /> : null}
            </span>
          )
        })}
      </div>
    </div>
  )
}
