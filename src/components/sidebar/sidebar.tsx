import Logo from '@/assets/location-pin-svgrepo-com.svg?react';
import { Map, ScanEye, SquareChartGantt } from 'lucide-react'
import { cn } from "@/lib/utils"
import { Link, useLocation } from 'react-router';

const menuButtons = [
  {
    tooltip: "Detection",
    url: "/detection",
    icon: ScanEye,
  },
  {
    tooltip: "Map",
    url: "/map",
    icon: Map,
  },
  {
    tooltip: "Reports",
    url: "/reports",
    icon: SquareChartGantt,
  },
]

function Sidebar(){
  const location = useLocation();

  return (
    <div className="w-12 bg-white dark:bg-slate-800 flex flex-col items-center border-r border-slate-200 dark:border-slate-700">

      {/* Logo */}
      <div className="w-fit h-fit rounded-md bg-slate-800 dark:bg-slate-600 p-1.5 my-4">
        <Logo className="w-5 h-5 text-white fill-current"/>
      </div>

      {/* Nav Items */}
      <div className="flex flex-col items-center gap-2">
        {menuButtons.map((button, index) => {
          const isActive = location.pathname === button.url;
          return (
            <Link
              key={index}
              to={button.url}
              className={cn(
                "group relative flex p-2 items-center justify-center rounded-md transition-all duration-200 ease-in-out active:scale-95",
                isActive
                  ? "bg-blue-500 shadow-sm"
                  : "hover:bg-slate-100 dark:hover:bg-slate-700"
              )}
            >
              <button.icon className={cn(
                "w-5 h-5 transition-colors",
                isActive
                  ? "text-white"
                  : "text-slate-500 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-slate-100"
              )}/>

              {/* Tooltip */}
              <div className="pointer-events-none absolute left-full ml-2 z-50 whitespace-nowrap rounded-md bg-slate-800 dark:bg-slate-700 px-2 py-1 text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity duration-150 shadow-md">
                {button.tooltip}
                {/* Arrow pointing left */}
                <div className="absolute top-1/2 -left-1 -translate-y-1/2 border-4 border-transparent border-r-slate-800 dark:border-r-slate-700"/>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  )
}

export default Sidebar;