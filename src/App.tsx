// import { useState } from 'react'
import '@/App.css'
import Sidebar from "@/components/sidebar/sidebar" 
import { Routes, Route } from 'react-router'
import DetectionPage from './components/pages/page-detection'
import MapPage from './components/pages/page-map'
import ReportsPage from './components/pages/page-reports'
import SettingsPage from './components/pages/page-settings'

function App() {
  // const [count, setCount] = useState(0)

  return (
    <>
      <div className="h-full w-full flex flex-row">
        <Sidebar/>
        <main className="h-full w-full">
          <Routes>
            <Route path="/" />
            <Route path="/detection" element={<DetectionPage/>} />
            <Route path="/map"       element={<MapPage/>} />
            <Route path="/reports"   element={<ReportsPage/>} />
            <Route path="/settings"  element={<SettingsPage/>} />
          </Routes>
        </main>
      </div>
    </>
  )
}

export default App
