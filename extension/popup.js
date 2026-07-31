document.querySelector('#open-site').addEventListener('click', () => {
  chrome.tabs.create({
    url: 'https://driftingboats.github.io/weibo-article-archive/'
  });
});
