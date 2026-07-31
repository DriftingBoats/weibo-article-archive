import { describe, expect, it } from 'vitest';
import { LocalImageOcr } from '../src/ocr.js';

describe('local image OCR', () => {
  it('downloads through the extension and stores clean OCR data', async () => {
    const bridge = {
      fetchImage: async () => ({ dataUrl: 'data:image/png;base64,AA==' })
    };
    const worker = {
      setParameters: async () => {},
      recognize: async () => ({
        data: {
          text: '  第一行  \n\n\n第二行\n',
          confidence: 88.46
        }
      }),
      terminate: async () => {}
    };
    const ocr = new LocalImageOcr({
      bridge,
      createOcrWorker: async () => worker
    });
    const result = await ocr.recognizeImages([{
      index: 1,
      marker: '[图片 1]',
      url: 'https://wx1.sinaimg.cn/example.png',
      ocrText: '',
      ocrStatus: 'pending'
    }]);
    expect(result[0]).toEqual(expect.objectContaining({
      ocrText: '第一行\n\n第二行',
      ocrStatus: 'done',
      ocrConfidence: 88.5
    }));
  });

  it('keeps a recoverable error on an unreadable image', async () => {
    const ocr = new LocalImageOcr({
      bridge: {
        fetchImage: async () => {
          throw new Error('图片不可用');
        }
      },
      createOcrWorker: async () => {
        throw new Error('worker should not be created');
      }
    });
    const [result] = await ocr.recognizeImages([{
      index: 1,
      url: 'https://wx1.sinaimg.cn/missing.png',
      ocrStatus: 'pending'
    }]);
    expect(result.ocrStatus).toBe('error');
    expect(result.ocrError).toBe('图片不可用');
  });
});
