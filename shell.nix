let
  nixpkgs = builtins.fetchTarball {
    url = "https://github.com/NixOS/nixpkgs/archive/nixos-25.05.tar.gz";
  };
  pkgs = import nixpkgs { };
in
pkgs.mkShellNoCC {
  packages = with pkgs; [
    nodejs_22
    pkgs.bashInteractive
  ];

  # Ensure Nix uses this bash, not system bash
  shell = pkgs.bashInteractive;

  shellHook = ''
    export PS1="\[\033[0;32m\][\u@\h \W]\\$ \[\033[0m\]"
    echo -ne "\033[0;31mThesis Nix Environment\033[0m\n"
    echo -ne "\033[0;31mNode Version:\033[0;33m $(node --version)\033[0m\n"
    export OZONE_PLATFORM=wayland
    export ELECTRON_OZONE_PLATFORM_HINT=wayland    #node --version
    
  '';
}
