# The science of accelerated playback

**TL;DR: faster playback translates to better engagement and retention.**

Average adult reads prose text at [250 to 300 words per minute](http://www.paperbecause.com/PIOP/files/f7/f7bb6bc5-2c4a-466f-9ae7-b483a2c0dca4.pdf) (wpm). By contrast, the average rate of speech for English speakers is ~150 wpm, with slide presentations often closer to 100 wpm. As a result, when given the choice, many viewers [speed up video playback to ~1.3\~1.5 its recorded rate](http://research.microsoft.com/en-us/um/redmond/groups/coet/compression/chi99/paper.pdf) to compensate for the difference.

Many viewers report that [accelerated viewing keeps their attention longer](http://www.enounce.com/docs/BYUPaper020319.pdf): faster delivery keeps the viewer more engaged with the content. In fact, with a little training many end up watching videos at 2x+ the recorded speed. Some studies report that after being exposed to accelerated playback, [listeners become uncomfortable](http://alumni.media.mit.edu/~barons/html/avios92.html#beasleyalteredspeech) if they are forced to return to normal rate of presentation.


## Faster HTML5 Video

HTML5 video provides a native API to accelerate playback of any video. The problem is, many players either hide, or limit this functionality. For best results playback speed adjustments should be easy and frequent to match the pace and content being covered: we don't read at a fixed speed, and similarly, we need an easy way to accelerate the video, slow it down, and quickly rewind the last point to listen to it a few more times.

![Player](https://cloud.githubusercontent.com/assets/2400185/24076745/5723e6ae-0c41-11e7-820c-1d8e814a2888.png)

#### *[Install Chrome Extension](https://chrome.google.com/webstore/detail/video-speed-controller/nffaoalbilbmmfgbnbgppjihopabppdk)*

Once the extension is installed simply navigate to any page that offers HTML5 video ([example](http://www.youtube.com/watch?v=E9FxNzv1Tr8)), and you'll see a speed indicator in top left corner. Hover over the indicator to reveal the controls to accelerate, slowdown, and quickly rewind or advance the video. Or, even better, simply use your keyboard:

* **S** - decrease playback speed.
* **D** - increase playback speed.
* **R** - reset playback speed.
* **Z** - rewind video by 10 seconds.
* **X** - advance video by 10 seconds.
* **V** - show/hide the controller.

_Note: you can customize these shortcut keys in the extension settings page._

### FAQ

**The video controls are not showing up?** This extension is only compatible with HTML5 video. If you don't see the controls showing up, chances are you are viewing a Flash video. If you want to confirm, try right-clicking on the video and inspect the menu: if it mentions flash, then that's the issue. That said, most sites will fallback to HTML5 if they detect that Flash it not available. You can try manually disabling Flash plugin in Chrome:

* In a new tab, navigate to `chrome://plugins`
* Disable "Adobe Flash Player"
* Restart your browser and try playing your video again

**The speed controls are not showing up for local videos?** To enable playback of local media (e.g. File > Open File), you need to grant additional permissions to the extension.

* In a new tab, navigate to `chrome://extensions`
* Find "Video Speed Controller" extension in the list and enable "Allow access to file URLs"
* Open a new tab and try opening a local file, the controls should show up

### License

(MIT License) - Copyright (c) 2014 Ilya Grigorik
