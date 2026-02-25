declare module "zstd-codec" {
  export namespace ZstdCodec {
    function run(
      callback: (zstd: { Simple: new () => { decompress: (data: Uint8Array) => Uint8Array } }) => void,
    ): void;
  }
}
