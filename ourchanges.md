- Added common block of code to inject.js and options.js, could be moved to a share.js file potentially but might decrease load time. Can be directly copied from one to the other with changes.  We also store a copy (`tcDefaults`) of the plugins default settings.  This allows us to easily reference any default if desired, but more importantly allows us to auto-detect the field type for each setting field rather than having to hard code it.

- Rather than hardcode each setting where we need it (and what to sync), the name of the synced settings is stored in an array we can use instead.  This allows for less boilerplate code.  Made new options easier to add and in fewer locations.  This should help prevent errors where a setting may not be synced or get overwritten if one file is updated without updating the other properly.  

- new `SettingFieldsBeforeSync`  Map variable that contains any transformations we need to do on a settings field prior to syncing.

- Added `logLevel` as an exposed setting so users can adjust.

- Added ability to edit the raw json of the saved settings (ie for items not in the UI, but more useful for quickly exporting / importing settings).  Only shows up with advanced options.

- Added basic syntax highlighting textbox for the json option box - [GitHub - WebCoder49/code-input](https://github.com/WebCoder49/code-input)

- Added `ifSpeedIsNormalDontSaveUnlessWeSetIt` option.  This is kind of like the 'forced' option but a more gentle version.  Essentially it allows anything to set the speed, and will update the stored speed (if enabled) with that speed  as long as that speed is not 1.0.   The idea being that while a website may automatically set the speed back to normal it is unlikely they would set it to a speed other than 1.0 without the user specifically preferring that.   This was first added for youtube.com that has a habit of setting the speed to 1.0 on navigate away breaking any stored speed previous.  This did require propagating the event further down into the class, but I see no negative effects of doing so.

- Made button presses on options page a bit more obvious by animating them and adding hover styling.

- Improved logging adding the caller information (where available) and more details when a video event happens incase there may be multiple video players to determine which one.

- Added the ability to automatically enable subtitles and auto disable autoplay for youtube.com.