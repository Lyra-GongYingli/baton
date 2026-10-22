import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { Capture } from './Capture'
import './styles.css'

const isCapture = location.hash === '#capture'
document.body.classList.toggle('capture-body', isCapture)

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isCapture ? <Capture /> : <App />}</StrictMode>
)
