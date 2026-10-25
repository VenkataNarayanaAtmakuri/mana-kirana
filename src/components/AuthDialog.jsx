import { useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'

function indianE164(value) {
  const digits = value.replace(/\D/g, '')
  if (digits.length !== 10) return ''
  return '+91' + digits
}

export default function AuthDialog({ onClose }) {
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [providerSetupNeeded, setProviderSetupNeeded] = useState(false)
  const [notice, setNotice] = useState('')

  async function sendCode(event) {
    event.preventDefault()
    const e164 = indianE164(phone)
    if (!e164) {
      setError('Enter a valid 10-digit Indian mobile number.')
      return
    }
    setBusy(true)
    setError('')
    setProviderSetupNeeded(false)
    const { error: sendError } = await supabase.auth.signInWithOtp({ phone: e164 })
    setBusy(false)
    if (sendError) {
      const providerErrorText = `${sendError.code || ''} ${sendError.message || ''}`.replaceAll('_', ' ')
      const providerIssue = /unsupported phone provider|phone provider.*disabled|sms provider/i.test(providerErrorText)
      setProviderSetupNeeded(providerIssue)
      setError(providerIssue
        ? 'Phone OTP is not configured for this Supabase project. In Supabase, open Authentication → Providers → Phone, enable it, select an SMS provider, enter its credentials, and save. Then try again.'
        : sendError.message)
      return
    }
    setSent(true)
    setNotice('A one-time code was sent to +91 ' + e164.slice(3) + '.')
  }

  async function verifyCode(event) {
    event.preventDefault()
    const e164 = indianE164(phone)
    if (!e164 || !/^\d{6}$/.test(code.trim())) {
      setError('Enter the 6-digit code sent to your phone.')
      return
    }
    setBusy(true)
    setError('')
    const { error: verifyError } = await supabase.auth.verifyOtp({ phone: e164, token: code.trim(), type: 'sms' })
    setBusy(false)
    if (verifyError) {
      setError(verifyError.message)
      return
    }
    onClose()
  }

  return (
    <div className="auth-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button className="auth-close" type="button" onClick={onClose} aria-label="Close sign in">×</button>
        <p className="eyebrow">MANA KIRANA ACCOUNT</p>
        <h2 id="auth-title">{sent ? 'Verify your mobile' : 'Sign in with your phone'}</h2>
        <p className="muted">We’ll send a one-time SMS code to verify your number.</p>
        {!sent ? (
          <form className="auth-form" onSubmit={sendCode}>
            <label htmlFor="auth-phone">Mobile number</label>
            <div className="auth-phone-input"><span>+91</span><input id="auth-phone" type="tel" inputMode="numeric" autoComplete="tel-national" value={phone} onChange={(event) => { setPhone(event.target.value); setError(''); setProviderSetupNeeded(false) }} placeholder="10-digit number" required /></div>
            <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Sending code…' : 'Send sign-in code'}</button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={verifyCode}>
            <label htmlFor="auth-code">6-digit SMS code</label>
            <input id="auth-code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" required />
            <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Checking code…' : 'Verify and continue'}</button>
            <button className="auth-resend" type="button" onClick={() => { setSent(false); setCode(''); setNotice('') }}>Use another number</button>
          </form>
        )}
        {notice && <p className="auth-notice" role="status">{notice}</p>}
        {error && <p className="auth-error" role="alert">{error}</p>}
        {providerSetupNeeded && <a className="auth-doc-link" href="https://supabase.com/docs/guides/auth/phone-login" target="_blank" rel="noreferrer">Supabase phone sign-in setup guide</a>}
        <p className="auth-disclaimer">Phone sign-in needs an SMS provider configured in the Supabase project.</p>
      </section>
    </div>
  )
}
