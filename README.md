# **Video Speed Controller**

## _[Install Chrome Extension](https://chrome.google.com/webstore/detail/video-speed-controller/nffaoalbilbmmfgbnbgppjihopabppdk)_

## **Benefits of Faster HTML5 Video**
---

![Player](https://cloud.githubusercontent.com/assets/2400185/24076745/5723e6ae-0c41-11e7-820c-1d8e814a2888.png)

Video Speed Controller is a Chrome extension that allows you to control the playback speed of HTML5 videos on any website. With the average adult reading at [250 to 300 words per minute](http://www.paperbecause.com/PIOP/files/f7/f7bb6bc5-2c4a-466f-9ae7-b483a2c0dca4.pdf) and the average English speech rate at around 150 wpm, many viewers find it helpful to [speed up video playback to ~1.3\~1.5 its recorded rate](http://research.microsoft.com/en-us/um/redmond/groups/coet/compression/chi99/paper.pdf) in order to maintain engagement with the content. Studies have also shown that [accelerated playback can lead to increased attention and retention of information](http://www.enounce.com/docs/BYUPaper020319.pdf).

Many viewers report that faster delivery keeps the viewer more engaged with the content. In fact, with a little training, many end up watching videos at 2x+ the recorded speed. Some studies report that after being exposed to accelerated playback, [listeners become uncomfortable](http://alumni.media.mit.edu/~barons/html/avios92.html#beasleyalteredspeech) if they are forced to return to normal rate of presentation.

**TL;DR: faster playback translates to better engagement and retention.**

HTML5 video provides a native API to accelerate playback of any video. The problem is many players either hide or limit this functionality. For the best results, playback speed adjustments should be easy and frequent to match the pace and content being covered: we don't read at a fixed speed, and similarly, we need an easy way to accelerate the video, slow it down, and quickly rewind the last point to listen to it a few more times.

## **Key Features**

---

- Control playback speed with a simple, intuitive interface
- Easily slow down, speed up, rewind, or advance videos with keyboard shortcuts
- Customizable keyboard shortcuts to match your preferred speeds and control methods
- Compatible with HTML5 videos on any website

## **Installation and Usage**

---

Install the Video Speed Controller Extension from the [Chrome Web Store](https://chrome.google.com/webstore/detail/video-speed-controller/nffaoalbilbmmfgbnbgppjihopabppdk). Once installed, simply navigate to any page with HTML5 video ([example](http://www.youtube.com/watch?v=E9FxNzv1Tr8)) and you will see a speed indicator in the top left corner. Hover over the indicator to reveal the controls to change the playback speed, rewind, advance, and more. Or, even better, simply use your keyboard:

### **Keyboard Shortcuts**

- **S** - decrease playback speed.
- **D** - increase playback speed.
- **R** - reset playback speed to 1.0x.
- **Z** - rewind video by 10 seconds.
- **X** - advance video by 10 seconds.
- **G** - toggle between current and user configurable preferred speed.
- **V** - show/hide the controller.

### **Keyboard Shortcut Customization**

You can customize and reassign the default shortcut keys in the extensions settings page as well as add additional shortcut keys to match your preferences. As an example, you can assign multiple "preferred speed" shortcuts with different values, allowing you to quickly toggle between your most frequently used speeds. To add a new shortcut, open extension settings and click "Add New".

![settings Add New shortcut](https://user-images.githubusercontent.com/121805/50726471-50242200-1172-11e9-902f-0e5958387617.jpg)

## **FAQ**

---

- **The video controls are not showing up?** This extension is only compatible with HTML5 video. If you don't see the controls showing up, chances are you are viewing a Flash video. If you want to confirm, try right-clicking on the video and inspect the menu: if it mentions flash, then that's the issue. That said, most sites will fallback to HTML5 if they detect that Flash it not available. You can try manually disabling Flash plugin in Chrome:
  - In a new tab, navigate to `chrome://settings/content/flash`
  - Disable "Allow sites to run Flash"
  - Restart your browser and try playing your video again  
- **The speed controls are not showing up for local videos?** To enable playback of local media (e.g. File > Open File), you need to grant additional permissions to the extension.
  - In a new tab, navigate to `chrome://extensions`
  - Find "Video Speed Controller" extension in the list and enable "Allow access to file URLs"
  - Open a new tab and try opening a local file; the controls should show up.  
- **Issues with shortcut keys?** Some sites may assign other functionality to one of the shortcut keys. As a workaround, the extension listens to both lower and uppercase values (i.e. you can use `Shift-<shortcut>`). This may not work for all sites, but it works for most.
- **What is the maximum and minimum speedup?** Videos can be sped up to 16.00x the original speed and can be lowered to 0.07x the original speed!

## **License**

---
(MIT License) - Copyright (c) 2014 Ilya Grigorik
