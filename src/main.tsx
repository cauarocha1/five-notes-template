import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import './styles.css'

import { registerSW } from 'virtual:pwa-register'

const updateServiceWorker = registerSW({
  immediate: true,
  onNeedRefresh() { window.dispatchEvent(new Event('five:update-ready')) },
})

window.addEventListener('five:apply-update', () => { void updateServiceWorker(true) })

class AppErrorBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false }

  componentDidMount() {
    const rootElement = document.getElementById('root')
    if (rootElement) rootElement.dataset.appReady = 'true'
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    console.error('five could not render the current screen', error.name)
  }

  render() {
    if (this.state.failed) return <main className="boot-screen" role="alert"><div className="boot-brand">five</div><span>Não foi possível mostrar esta tela. Suas notas locais continuam no aparelho.</span><button className="secondary-button" onClick={() => window.location.reload()}>Tentar novamente</button></main>
    return this.props.children
  }
}

const rootElement = document.getElementById('root')!

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <AppErrorBoundary><App /></AppErrorBoundary>
  </React.StrictMode>,
)
