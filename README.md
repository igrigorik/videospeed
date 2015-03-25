# The science of accelerated playback

**TL;DR: faster playback translates to quick progress, better engagement, and retention.**

Average adult reads prose text at [250 to 300 words per minute](http://www.paperbecause.com/PIOP/files/f7/f7bb6bc5-2c4a-466f-9ae7-b483a2c0dca4.pdf) (wpm). By contrast, the average rate of speech for English speakers is ~150 wpm, with slide presentations often closer to 100 wpm. As a result, when given the choice, many viewers [speed up video playback to ~1.3~1.5 its recorded rate](http://research.microsoft.com/en-us/um/people/lhe/papers/chi99.tc.pdf) to compensate for the difference.

Many viewers report that [accelerated viewing keeps their attention longer](http://www.enounce.com/docs/BYUPaper020319.pdf): faster delivery keeps the viewer more engaged with the content. In fact, with a little training many end up watching videos at 2x+ the recorded speed. Some studies report that after being exposed to accelerated playback, [listeners become uncomfortable](http://xenia.media.mit.edu/~barons/html/avios92.html#beasleyalteredspeech) if they are forced to return to normal rate of presentation.


## Faster HTML5 Video

HTML5 video provides a native API to accelerate playback of any video. The problem is, many players either hide, or limit this functionality. For best results playback speed adjustments should be easy and frequent to match the pace and content being covered: we don't read at a fixed speed, and similarly, we need an easy way to accelerate the video, slow it down, and quickly rewind the last point to listen to it a few more times.

![Player](https://lh5.googleusercontent.com/ubqr74funulW1oj_SEDFQBpj_hE26j3aR5G9wfoAZlo1u029_vM9_tlV_f27AvTVWXcB2Hfy81I=s640)

#### *[Install Chrome Extension](https://chrome.google.com/webstore/detail/video-speed-controller/nffaoalbilbmmfgbnbgppjihopabppdk)*

Once the extension is installed simply navigate to any page that offers HTML5 video ([example](http://www.youtube.com/watch?v=E9FxNzv1Tr8)), and you'll see a speed indicator in top left corner. Hover over the indicator to reveal the controls to accelerate, slowdown, or rewind the video (10 seconds + lowers playback speed). Or, even better, simply use your keyboard:

* **a** - will rewind video 10s and lower playback speed **by 10 points**.
* **s** - will lower playback speed.
* **d** - will accelerate playback speed.

Note that you can customize these shortcuts in the extension settings page. Also, a few tips for enabling and forcing HTML5 video:

 * YouTube: make sure you [enable the HTML5 opt-in experiment](http://www.youtube.com/html5).
 * If you're adventurous, try disabling the Flash plugin in Chrome in chrome://plugins/


### Wishlist

* Make it not suck with Vimeo content: "s" shortcut and button clicks
* Show actual playback speed
* Your awesome feature here...


### License

(MIT License) - Copyright (c) 2014 Ilya Grigorik
