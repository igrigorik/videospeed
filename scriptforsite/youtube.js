document.addEventListener('yt-navigate-finish', function(event) {
    if (!location.pathname.includes('/watch')) { return; };
    
    const videoPlayerContainer = document.querySelector(".html5-video-container");
    if (videoPlayerContainer) {
        videoPlayerContainer.setAttribute('draggable', false);
    }
}, false);