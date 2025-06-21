# Manual E2E Testing Guide for Video Speed Controller

Since automated E2E testing requires a GUI environment that may not be available in all systems, here's a manual testing guide to verify the extension works correctly.

## Prerequisites

1. Chrome browser installed
2. Extension loaded in developer mode

## Loading the Extension

1. Open Chrome
2. Go to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the videospeed project directory
6. Verify the extension appears in the list

## Test Cases

### 1. Basic Functionality Test

**URL:** https://www.youtube.com/watch?v=gGCJOTvECVQ

**Steps:**
1. Navigate to the YouTube URL
2. Wait for video to load
3. Look for the Video Speed Controller overlay (small speed indicator)
4. Verify the controller shows "1.00" initially

**Expected Results:**
- ✅ Speed controller appears over the video
- ✅ Shows current speed (1.00x)
- ✅ Controller has +, -, reset, and other buttons

### 2. Speed Control Test

**Steps:**
1. Click the "+" (faster) button
2. Observe speed changes to ~1.10
3. Click the "-" (slower) button  
4. Observe speed changes to ~1.00
5. Click faster multiple times
6. Click the reset button

**Expected Results:**
- ✅ Video speed increases with "+"
- ✅ Video speed decreases with "-"
- ✅ Speed display updates accordingly
- ✅ Reset button returns to 1.00x
- ✅ Video playback actually speeds up/slows down

### 3. Keyboard Shortcuts Test

**Steps:**
1. Focus on the video (click on it)
2. Press 'D' key (faster)
3. Press 'S' key (slower)
4. Press 'R' key (reset)
5. Press 'Z' key (rewind)
6. Press 'X' key (advance)

**Expected Results:**
- ✅ 'D' increases speed
- ✅ 'S' decreases speed  
- ✅ 'R' resets to 1.00x
- ✅ 'Z' rewinds video by ~10 seconds
- ✅ 'X' advances video by ~10 seconds

### 4. YouTube Integration Test

**Steps:**
1. Pause/play the video using YouTube controls
2. Seek to different positions in the video
3. Change quality settings
4. Verify speed controller remains functional

**Expected Results:**
- ✅ Speed settings persist through pause/play
- ✅ Speed settings persist through seeking
- ✅ Controller remains visible and functional
- ✅ Speed changes affect actual playback rate

### 5. Settings Persistence Test

**Steps:**
1. Set video speed to 1.5x
2. Navigate to another YouTube video
3. Check if speed setting is remembered (depends on settings)

**Expected Results:**
- ✅ Speed may reset to 1.0x or remember 1.5x (based on extension settings)
- ✅ Controller appears on new video
- ✅ All functionality works on new video

### 6. Cross-Site Test

**Test URLs:**
- https://vimeo.com/90509568
- https://developer.mozilla.org/en-US/docs/Web/HTML/Element/video (scroll to examples)

**Steps:**
1. Navigate to different video sites
2. Verify controller appears
3. Test speed controls

**Expected Results:**
- ✅ Controller works on multiple video sites
- ✅ All functionality is consistent across sites

## Troubleshooting

### Controller Not Appearing
- Check if extension is enabled in chrome://extensions/
- Refresh the page
- Check browser console for errors (F12 → Console)

### Speed Not Changing
- Verify video is playing (not paused)
- Check if site has custom video controls that interfere
- Try keyboard shortcuts instead of buttons

### Performance Issues
- Lower video quality if needed
- Close other tabs to free up resources

## Reporting Results

For each test case, note:
- ✅ PASS: Feature works as expected
- ⚠️ PARTIAL: Feature works but with issues
- ❌ FAIL: Feature doesn't work
- 🔍 NOTES: Any additional observations

## Expected Final Result

All test cases should pass, confirming:
1. Extension loads correctly
2. Video detection works
3. Speed controls function properly
4. Keyboard shortcuts work
5. Settings persist appropriately
6. Cross-site compatibility