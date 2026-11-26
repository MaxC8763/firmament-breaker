// 截圖平常寫進 test-results/（不進 git）；SAVE_SCREENSHOTS=1 時寫進 screenshots/，留作進度紀錄
export const shotPath = (name: string) =>
  `${process.env.SAVE_SCREENSHOTS ? 'screenshots' : 'test-results'}/${name}.png`;
