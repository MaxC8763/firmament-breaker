// 美術管線寫出的 manifest.json 裡，遊戲會用到的部分

export interface ArtFrame {
  file: string;
  /** 這張停幾格（以 fps 計） */
  hold: number;
}

export interface ArtGroup {
  /** 1x 畫布 [寬, 高] */
  canvas: [number, number];
  /** 1x 腳底 [x, y] */
  pivot?: [number, number];
  fps: number;
  loop: boolean;
  frames?: ArtFrame[];
}

/** [左, 上, 右, 下)，1x 原始畫布上的像素；全透明的圖是 null */
type Box = [number, number, number, number] | null;

export interface ArtImage {
  /** alpha ≥ 128 的範圍，也就是看得到的部分 */
  bounds: Box;
}

export interface Manifest {
  /** 資料夾（例如 hero/idle）→ 它的 meta.json */
  groups: Record<string, ArtGroup>;
  /** 有成功產出的圖；key 是 atlas 的格名（<資料夾>/<file>） */
  images: Record<string, ArtImage>;
}
