import Logo from '@/assets/location-pin-svgrepo-com.svg?react';
import { Map, ScanEye, Settings2, SquareChartGantt } from 'lucide-react'

const menuButtons = [
  {
    tooltip: "Detect Page",
    url: "#",
    icon: ScanEye,
  },
  {
    tooltip: "Map Page",
    url: "#",
    icon: Map,
  },
  {
    tooltip: "Reports Page",
    url: "#",
    icon: SquareChartGantt,
  },
  {
    tooltip: "Settings Page",
    url: "#",
    icon: Settings2,
  },
]

function Sidebar(){
  return (
    <div className="w-12 bg-slate-50 flex flex-col items-center">
        <div className="w-fit h-fit rounded-md bg-slate-800 p-1.5 my-4">
          <Logo className="w-5 h-5 text-white fill-current"/>
        </div>
      <div className="flex flex-col items-center gap-6">
      {menuButtons.map((button, index) => (
        <div key={index} className="w-fit h-fit rounded-sm">
          <button.icon className="w-5 h-5 text-slate-900"/>
        </div>
      ))}
      </div>
    </div>
    
  )
}

export default Sidebar;
