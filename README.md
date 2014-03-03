# The science of accelerated playback

Average adult reads prose text at [250 to 300 words per minute][1] (wpm). By contrast, the average rate of speech for English speakers is ~150 wpm, with slide presentations often closer to 100 wpm. As a result, when given the choice, many people [speed up video playback to ~1.3~1.5 its recorded rate][2] to compensate for the difference.

Better, many students report that [accelerated viewing keeps their attention longer][3]: faster deliver keeps the viewer more engaged with the content. With a little training, many end up watching videos comfortable at speeds twice the normal speed and even higher. In fact, some studies report that after being exposed to accelerated playback, [listeners become uncomfortable](http://xenia.media.mit.edu/~barons/html/avios92.html#beasleyalteredspeech) if they are forced to return to normal rate of presentation. 

*In short, faster playback can translate to better engagement and quicker progress.* 

## Faster HTML5 Video

Good news, HTML5 video provides a native API to accelerate playback of any video. The problem is, many players either hide, or limit this functionality. For best results, you want to be able to adjust the playback speed continuously: we don't read at a fixed speed, and similarly, you should have a simple and easy way to accelerate the video, slow it down, or quickly rewind the last point to listen to it a few more times.

![Stats](https://lh6.googleusercontent.com/0irdyySLwcMyzqWoqBWr6q3o8i1RNyJyY4Lfv0DX0adQlHuzqsf_5QrYs3Bte2Dc59wSUojGhg=s640-h400-e365-rw)

#### *[Install Chrome Extension](https://chrome.google.com/webstore/detail/html5-video-playback-spee/nffaoalbilbmmfgbnbgppjihopabppdk)*

Once the extension is installed simply navigate to any page that offers HTML5 video ([example](http://www.youtube.com/watch?v=E9FxNzv1Tr8)), and you'll see a speed indicator in top right corner. Hover over the indicator to reveal the controls to accelerate, slowdown, or rewind the video (10 seconds + lowers playback speed). Or, even better, simply use your keyboard:

* *a* - will rewind video 10s and lower playback speed.
* *s* - will lower playback speed.
* *d* - will accelerate playback speed.

Enjoy. Also, as a protip for YouTube: make sure you [enable the HTML5 opt-in experiment](http://www.youtube.com/html5)!


## Wishlist / Todo list

* Make it not suck with Vimeo content: "s" shortcut and button clicks
* Some YouTube videos still fallback to flash: force iOS user-agent to force HTML5?
* Add plumbing for configurable shortcuts
* Your awesome feature here... Pull requests are welcome!


(MIT License) - Copyright (c) 2014 Ilya Grigorik


[1](http://www.paperbecause.com/PIOP/files/f7/f7bb6bc5-2c4a-466f-9ae7-b483a2c0dca4.pdf)
[2](http://research.microsoft.com/en-us/um/people/lhe/papers/chi99.tc.pdf)
[3](http://www.enounce.com/docs/BYUPaper020319.pdf)
