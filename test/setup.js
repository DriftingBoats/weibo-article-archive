import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://driftingboats.github.io/weibo-article-archive/'
});

globalThis.Node = dom.window.Node;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.document = dom.window.document;
globalThis.window = dom.window;
