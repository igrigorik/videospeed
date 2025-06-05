window.addEventListener(
  "message",
  function (event) {
    // Only proceed if the message is intended for the Google Drive player
    if (
      event.origin !== "https://drive.google.com" ||
      event.data.action !== "videospeed-seek" ||
      !event.data.seekMs
    ) {
      return;
    }

    // Locate the video element on the Google Drive page
    const videoElement = document.querySelector("video");

    // Ensure the video element exists before proceeding
    if (videoElement) {
      // Add the seek time (in milliseconds converted to seconds) to the current time
      videoElement.currentTime += event.data.seekMs / 1000;
    } else {
      console.warn("Video element not found on Google Drive.");
    }
  },
  false
);
