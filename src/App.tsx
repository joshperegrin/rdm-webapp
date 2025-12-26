// import { useState } from 'react'
import '@/App.css'
import Sidebar from "@/components/sidebar/sidebar" 

function App() {
  // const [count, setCount] = useState(0)

  return (
    <>
      <div className="h-full w-full flex flex-row">
        <Sidebar/>
      </div>
    </>
  )
}

export default App
