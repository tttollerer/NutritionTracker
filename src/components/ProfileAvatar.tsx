import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { User } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Profil-Einstieg als Avatar oben rechts (neue Navigation): Profil hat keinen
 * eigenen Tab mehr — die Tab-Leiste gehört Heute · Woche · [+] · Einkauf · Coach.
 * Brand-Gradient wie der Capture-CTA; ohne Namensfeld im Profil zeigt der
 * Avatar ein User-Icon statt Initialen.
 */
export function ProfileAvatar() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.92 }}
      onClick={() => navigate('/profile')}
      aria-label={t('nav.profile')}
      className="focus-ring flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-primary-foreground shadow-sm"
    >
      <User size={19} strokeWidth={2.4} />
    </motion.button>
  )
}
