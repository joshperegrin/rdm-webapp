import { Button } from "@/components/ui/button";
import { CirclePlay, CircleStop } from "lucide-react";

function DetectionPage(){
  const lmao = () => {}
  const connect_client = () => {
    window.rasp_connection.connect_client("192.168.1.14", 12345)
  }
  return (
    <div className="flex flex-row h-full w-full">
      <div className="hidden md:flex md:w-1/3 lg:w-90 ">
        <Button onClick={lmao} className="cursor-pointer" variant="outline" size="sm">
          <CirclePlay /> Start
          <CircleStop /> Stop
        </Button>
        <Button onClick={connect_client} className="cursor-pointer" variant="outline" size="sm">
          Connect
        </Button>
      </div>
      <div className="flex flex-1">
      </div>
    </div>
  )
}

export default DetectionPage;
