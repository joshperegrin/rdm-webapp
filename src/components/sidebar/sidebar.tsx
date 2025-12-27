import Logo from '@/assets/location-pin-svgrepo-com.svg?react';
import { Map, ScanEye, Settings2, SquareChartGantt } from 'lucide-react'
import { cn } from "@/lib/utils"
import { Link, useNavigate } from 'react-router';

const menuButtons = [
  {
    tooltip: "Detect Page",
    url: "/detection",
    icon: ScanEye,
  },
  {
    tooltip: "Map Page",
    url: "/map",
    icon: Map,
  },
  {
    tooltip: "Reports Page",
    url: "/reports",
    icon: SquareChartGantt,
  },
  {
    tooltip: "Settings Page",
    url: "/settings",
    icon: Settings2,
  },
]

function Sidebar(){
  return (
    <div className="w-12 bg-slate-50 flex flex-col items-center border-r border-slate-200">
        <div className="w-fit h-fit rounded-md bg-slate-800 p-1.5 my-4">
          <Logo className="w-5 h-5 text-white fill-current"/>
        </div>
      <div className="flex flex-col items-center gap-5">
        {menuButtons.map((button, index) => (
        <Link
          key={index}
          to={button.url}
          className={cn(
            "group relative flex p-1.5 items-center justify-center rounded-md transition-all duration-200 ease-in-out",
            "hover:bg-slate-200 active:scale-95",)}>
          <button.icon className="w-5 h-5 text-slate-900"/>
        </Link>
        ))}
      </div>
    </div>
    
  )
}

export default Sidebar;
