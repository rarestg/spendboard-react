import { useState, type FormEvent } from 'react'

import { Spendboard, type IntegerSlots } from '../src'

type DisplayStatus = 'settled' | 'busy' | 'unknown'
type Theme = 'light' | 'dark'

type AppProps = {
  initialTheme: Theme
}

type ParseResult =
  | { cents: number }
  | { error: string }

const MAX_DOLLARS: Record<IntegerSlots, string> = {
  1: '9.99',
  2: '99.99',
  3: '999.99',
  4: '9,999.99',
}

function slotCountLabel(count: IntegerSlots) {
  return `${count} integer ${count === 1 ? 'slot' : 'slots'}`
}

function parseDollars(value: string, integerSlots: IntegerSlots): ParseResult {
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(value.trim())

  if (!match) {
    return {
      error: 'Enter a non-negative dollar amount with up to 2 decimal places.',
    }
  }

  const whole = match[1].replace(/^0+(?=\d)/, '')

  if (whole.length > integerSlots) {
    return {
      error: `Amount must be $${MAX_DOLLARS[integerSlots]} or less for ${slotCountLabel(integerSlots)}.`,
    }
  }

  const fraction = (match[2] ?? '').padEnd(2, '0')
  return { cents: Number(whole) * 100 + Number(fraction) }
}

export default function App({ initialTheme }: AppProps) {
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [status, setStatus] = useState<DisplayStatus>('settled')
  const [cents, setCents] = useState(31)
  const [draftAmount, setDraftAmount] = useState('0.31')
  const [integerSlots, setIntegerSlots] = useState<IntegerSlots>(2)
  const [error, setError] = useState('')

  const settle = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const result = parseDollars(draftAmount, integerSlots)

    if ('error' in result) {
      setError(result.error)
      return
    }

    setCents(result.cents)
    setStatus('settled')
    setError('')
  }

  const showStatus = (nextStatus: Exclude<DisplayStatus, 'settled'>) => {
    setStatus(nextStatus)
    setError('')
  }

  const changeIntegerSlots = (nextSlots: IntegerSlots) => {
    const maximumCents = 10 ** nextSlots * 100 - 1

    if (status === 'settled' && cents > maximumCents) {
      setError(
        `Amount must be $${MAX_DOLLARS[nextSlots]} or less for ${slotCountLabel(nextSlots)}.`,
      )
      return
    }

    setIntegerSlots(nextSlots)
    setError('')
  }

  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light'
    document.documentElement.dataset.theme = nextTheme
    setTheme(nextTheme)
  }

  const display =
    status === 'settled' ? (
      <Spendboard
        className="hero-display"
        status="settled"
        cents={cents}
        integerSlots={integerSlots}
      />
    ) : status === 'busy' ? (
      <Spendboard
        className="hero-display"
        status="busy"
        integerSlots={integerSlots}
      />
    ) : (
      <Spendboard
        className="hero-display"
        status="unknown"
        integerSlots={integerSlots}
      />
    )

  return (
    <div className="demo-shell">
      <header className="demo-header">
        <p className="eyebrow">SPLIT-FLAP</p>
        <button
          className="theme-toggle"
          type="button"
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
          onClick={toggleTheme}
        >
          <span className="theme-toggle__mark" aria-hidden="true" />
          <span>{theme === 'light' ? 'Dark' : 'Light'}</span>
        </button>
      </header>

      <main className="demo-main">
        <section className="instrument" aria-labelledby="demo-title">
          <div className="intro">
            <h1 id="demo-title">Spendboard</h1>
            <p>
              Real 3D flaps. An honest digit scramble while the total is
              unresolved.
            </p>
          </div>

          <div className="hero">{display}</div>

          <form className="controls" onSubmit={settle} noValidate>
            <fieldset className="state-control">
              <legend className="sr-only">Display state</legend>
              <button
                type="submit"
                aria-pressed={status === 'settled'}
                className={status === 'settled' ? 'is-selected' : undefined}
              >
                Settled
              </button>
              <button
                type="button"
                aria-pressed={status === 'busy'}
                className={status === 'busy' ? 'is-selected' : undefined}
                onClick={() => showStatus('busy')}
              >
                Busy
              </button>
              <button
                type="button"
                aria-pressed={status === 'unknown'}
                className={status === 'unknown' ? 'is-selected' : undefined}
                onClick={() => showStatus('unknown')}
              >
                Unknown
              </button>
            </fieldset>

            <div className="fields">
              <label className="field">
                <span>Amount</span>
                <span className="amount-input">
                  <span aria-hidden="true">$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    spellCheck="false"
                    value={draftAmount}
                    aria-invalid={Boolean(error)}
                    aria-describedby="amount-error"
                    onChange={(event) => setDraftAmount(event.target.value)}
                  />
                </span>
              </label>

              <label className="field">
                <span>Integer slots</span>
                <select
                  value={integerSlots}
                  onChange={(event) =>
                    changeIntegerSlots(
                      Number(event.target.value) as IntegerSlots,
                    )
                  }
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                  <option value={4}>4</option>
                </select>
              </label>
            </div>

            <p className="error" id="amount-error" role="alert">
              {error}
            </p>
          </form>
        </section>
      </main>
    </div>
  )
}
