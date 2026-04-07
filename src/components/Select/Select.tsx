import { Check, ChevronDown, Search } from 'lucide-react'
import {
  forwardRef,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import styles from './Select.module.scss'

export type SelectOption = {
  value: string
  label: string
  disabled?: boolean
}

interface SelectProps {
  id?: string
  name?: string
  value?: string
  options: SelectOption[]
  placeholder?: string
  searchable?: boolean
  searchPlaceholder?: string
  disabled?: boolean
  onChange?: (nextValue: string) => void
  className?: string
}

function joinClasses(...classes: Array<string | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

function findNextEnabledIndex(options: SelectOption[], startIndex: number, direction: 1 | -1): number {
  if (options.length === 0) return -1

  let index = startIndex
  for (let count = 0; count < options.length; count += 1) {
    index = (index + direction + options.length) % options.length
    if (!options[index]?.disabled) return index
  }

  return -1
}

export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  {
    id,
    name,
    value = '',
    options,
    placeholder = 'Select',
    searchable = false,
    searchPlaceholder = 'Search...',
    disabled = false,
    onChange,
    className,
  },
  ref,
) {
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [searchQuery, setSearchQuery] = useState('')
  const shellRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const listboxId = useId()

  const normalizedQuery = searchQuery.trim().toLowerCase()
  const visibleOptions = useMemo(() => {
    if (!searchable || !normalizedQuery) return options
    return options.filter((option) => option.label.toLowerCase().includes(normalizedQuery))
  }, [normalizedQuery, options, searchable])

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  )
  const selectedVisibleIndex = useMemo(
    () => visibleOptions.findIndex((option) => option.value === value),
    [value, visibleOptions],
  )
  const triggerLabel = selectedOption?.label ?? placeholder

  const setTriggerRefs = (node: HTMLButtonElement | null): void => {
    triggerRef.current = node

    if (!ref) return
    if (typeof ref === 'function') {
      ref(node)
      return
    }

    ref.current = node
  }

  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (shellRef.current?.contains(target)) return
      setIsOpen(false)
      setActiveIndex(-1)
      setSearchQuery('')
    }

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setIsOpen(false)
      setActiveIndex(-1)
      setSearchQuery('')
      triggerRef.current?.focus()
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    if (!searchable) return

    const timeoutId = window.setTimeout(() => {
      searchInputRef.current?.focus()
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [isOpen, searchable])

  useEffect(() => {
    if (!isOpen) return

    if (selectedVisibleIndex >= 0 && !visibleOptions[selectedVisibleIndex]?.disabled) {
      setActiveIndex(selectedVisibleIndex)
      return
    }

    setActiveIndex(findNextEnabledIndex(visibleOptions, -1, 1))
  }, [isOpen, selectedVisibleIndex, visibleOptions])

  const openMenu = (): void => {
    setIsOpen(true)
    setSearchQuery('')
  }

  const closeMenu = (): void => {
    setIsOpen(false)
    setActiveIndex(-1)
    setSearchQuery('')
  }

  const selectValue = (nextValue: string): void => {
    onChange?.(nextValue)
    closeMenu()
  }

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (disabled) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!isOpen) {
        openMenu()
        return
      }

      const next = findNextEnabledIndex(visibleOptions, activeIndex, 1)
      if (next >= 0) setActiveIndex(next)
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!isOpen) {
        openMenu()
        return
      }

      const next = findNextEnabledIndex(visibleOptions, activeIndex, -1)
      if (next >= 0) setActiveIndex(next)
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (!isOpen) {
        openMenu()
        return
      }

      if (activeIndex < 0) return
      const activeOption = visibleOptions[activeIndex]
      if (activeOption && !activeOption.disabled) {
        selectValue(activeOption.value)
      }
    }
  }

  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      const next = findNextEnabledIndex(visibleOptions, activeIndex, 1)
      if (next >= 0) setActiveIndex(next)
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      const next = findNextEnabledIndex(visibleOptions, activeIndex, -1)
      if (next >= 0) setActiveIndex(next)
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      if (activeIndex < 0) return
      const activeOption = visibleOptions[activeIndex]
      if (activeOption && !activeOption.disabled) {
        selectValue(activeOption.value)
      }
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu()
      triggerRef.current?.focus()
    }
  }

  return (
    <div ref={shellRef} className={joinClasses(styles.shell, disabled ? styles.shellDisabled : undefined)}>
      {name ? <input type='hidden' name={name} value={value} /> : null}
      <button
        id={id}
        ref={setTriggerRefs}
        type='button'
        className={joinClasses(styles.trigger, className)}
        onClick={() => {
          if (disabled) return
          if (isOpen) {
            closeMenu()
            return
          }
          openMenu()
        }}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup='listbox'
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        disabled={disabled}
      >
        <span className={selectedOption ? styles.value : styles.placeholder}>{triggerLabel}</span>
        <ChevronDown
          size={16}
          className={joinClasses(styles.icon, isOpen ? styles.iconOpen : undefined)}
          aria-hidden='true'
        />
      </button>

      {isOpen ? (
        <div className={styles.menu}>
          {searchable ? (
            <div className={styles.searchWrap}>
              <Search size={14} className={styles.searchIcon} aria-hidden='true' />
              <input
                ref={searchInputRef}
                type='text'
                value={searchQuery}
                placeholder={searchPlaceholder}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                className={styles.searchInput}
              />
            </div>
          ) : null}

          {visibleOptions.length === 0 ? (
            <p className={styles.emptyState}>No results found</p>
          ) : (
            <ul
              id={listboxId}
              role='listbox'
              className={styles.options}
              aria-activedescendant={activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
            >
              {visibleOptions.map((option, optionIndex) => {
                const isSelected = option.value === value
                const isActive = optionIndex === activeIndex

                return (
                  <li
                    id={`${listboxId}-option-${optionIndex}`}
                    key={`${option.value}-${option.label}`}
                    role='option'
                    aria-selected={isSelected}
                    className={joinClasses(
                      styles.option,
                      isSelected ? styles.optionSelected : undefined,
                      isActive ? styles.optionActive : undefined,
                      option.disabled ? styles.optionDisabled : undefined,
                    )}
                    onMouseEnter={() => setActiveIndex(optionIndex)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      if (!option.disabled) {
                        selectValue(option.value)
                      }
                    }}
                  >
                    <span>{option.label}</span>
                    {isSelected ? <Check size={14} className={styles.optionCheck} aria-hidden='true' /> : null}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
})
