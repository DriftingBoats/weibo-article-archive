import { createWorker, OEM, PSM } from 'tesseract.js';

const normalizeOcrText = (value) => String(value || '')
  .replace(/\r\n?/g, '\n')
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

export class LocalImageOcr {
  constructor({ bridge, createOcrWorker = createWorker } = {}) {
    this.bridge = bridge;
    this.createOcrWorker = createOcrWorker;
    this.workerPromise = null;
    this.progressListener = null;
  }

  async worker() {
    if (!this.workerPromise) {
      this.workerPromise = this.createOcrWorker(['chi_sim', 'eng'], OEM.LSTM_ONLY, {
        logger: (event) => this.progressListener?.(event)
      }).then(async (worker) => {
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.AUTO,
          preserve_interword_spaces: '1'
        });
        return worker;
      }).catch((error) => {
        this.workerPromise = null;
        throw error;
      });
    }
    return this.workerPromise;
  }

  async recognizeImages(images = [], onProgress = () => {}) {
    const results = images.map((image) => ({ ...image }));
    const pending = results.filter((image) =>
      image.url && !['done', 'empty'].includes(image.ocrStatus)
    );
    if (!pending.length) return results;

    for (let position = 0; position < pending.length; position += 1) {
      const image = pending[position];
      const current = position + 1;
      onProgress({
        phase: 'download',
        current,
        total: pending.length,
        percent: 0,
        message: `正在读取第 ${image.index} 张图片…`
      });
      try {
        const { dataUrl } = await this.bridge.fetchImage(image.url);
        const worker = await this.worker();
        this.progressListener = (event) => {
          if (event.status !== 'recognizing text') return;
          onProgress({
            phase: 'recognize',
            current,
            total: pending.length,
            percent: Math.round((event.progress || 0) * 100),
            message: `正在识别第 ${image.index} 张图片…`
          });
        };
        const { data } = await worker.recognize(dataUrl);
        const text = normalizeOcrText(data.text);
        image.ocrText = text;
        image.ocrStatus = text ? 'done' : 'empty';
        image.ocrConfidence = Number.isFinite(data.confidence)
          ? Math.round(data.confidence * 10) / 10
          : null;
        image.ocrError = '';
      } catch (error) {
        image.ocrStatus = 'error';
        image.ocrError = error.message || '图片文字识别失败。';
      } finally {
        this.progressListener = null;
      }
      onProgress({
        phase: image.ocrStatus,
        current,
        total: pending.length,
        percent: 100,
        message: image.ocrStatus === 'error'
          ? `第 ${image.index} 张图片识别失败，已保留原图地址。`
          : `已处理第 ${image.index} 张图片。`
      });
    }
    return results;
  }

  async terminate() {
    if (!this.workerPromise) return;
    try {
      const worker = await this.workerPromise;
      await worker.terminate();
    } finally {
      this.workerPromise = null;
      this.progressListener = null;
    }
  }
}
