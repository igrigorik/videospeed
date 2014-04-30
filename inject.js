chrome.extension.sendMessage({}, function(response) {
  var readyStateCheckInterval = setInterval(function() {
    if (document.readyState === "complete") {
      clearInterval(readyStateCheckInterval);

      var tc = tc || {};
      tc.videoController = function(target) {
        this.video = target;
        this.initializeControls();

        this.speedIndicator.textContent = this.getSpeed();
        this.video.addEventListener('ratechange', function(event) {
          this.speedIndicator.textContent = this.getSpeed();
        }.bind(this));

        // Resets speedIndicator display when src changes (e.g. youtube doesn't reload page)
        this.observer = new MutationObserver(function(mutations) {
          mutations.forEach(function(mutation) {
            if (mutation.attributeName.toLowerCase() == 'src') {
              self.speedIndicator.textContent = '1.00';
            }
          });
        });
        self = this;
        this.observer.observe(this.video, {attributes: true, attributeFilter: ['src']});
      };

      tc.videoController.prototype.getSpeed = function() {
        return parseFloat(this.video.playbackRate).toFixed(2);
      }

      tc.videoController.prototype.remove = function() {
        this.parentElement.removeChild(this);
      }

      tc.videoController.prototype.initializeControls = function() {
        var fragment = document.createDocumentFragment();
        var container = document.createElement('div');
        var speedIndicator = document.createElement('span');

        var controls = document.createElement('span');
        var fasterButton = document.createElement('button');
        var slowerButton = document.createElement('button');
        var rewindButton = document.createElement('button');

        rewindButton.innerHTML = '&laquo;';
        fasterButton.textContent = '+';
        slowerButton.textContent = '-';

        controls.appendChild(rewindButton);
        controls.appendChild(slowerButton);
        controls.appendChild(fasterButton);

        container.appendChild(speedIndicator);
        container.appendChild(controls);

        container.classList.add('tc-videoController');
        controls.classList.add('tc-controls');

        fragment.appendChild(container);
        this.video.parentElement.insertBefore(fragment, this.video);
        this.video.classList.add('tc-videoHost');

        this.speedIndicator = speedIndicator;

        container.addEventListener('click', function(e) {
          if      (e.target === slowerButton) { runAction('slower') }
          else if (e.target === fasterButton) { runAction('faster') }
          else if (e.target === rewindButton) { runAction('rewind') }
          else {
            container.nextSibling.classList.add("vc-cancelled")
            container.remove();
          }

          e.preventDefault();
          e.stopPropagation();
        }, true);

        // Prevent full screen mode on YouTube
        container.addEventListener('dblclick', function(e) {
          e.preventDefault();
          e.stopPropagation();
        }, true);

        // Prevent full screen mode on Vimeo
        container.addEventListener('mousedown', function(e) {
          e.preventDefault();
          e.stopPropagation();
        }, true);        
      }

      function runAction(action) {
        var videoTags = document.getElementsByTagName('video');
        videoTags.forEach = Array.prototype.forEach;

        videoTags.forEach(function(v) {
          if (!v.paused && !v.classList.contains("vc-cancelled")) {
            if (action === 'rewind') {
              v.playbackRate -= 0.20;
              v.currentTime -= 10;
            } else if (action === 'faster') { v.playbackRate += 0.10 }
              else if (action === 'slower') { v.playbackRate -= 0.10 }
          }
        });
      }

      document.addEventListener('keydown', function(event) {
        if      (event.keyCode == 65) { runAction('rewind') } // A
        else if (event.keyCode == 68) { runAction('faster') } // D
        else if (event.keyCode == 83) { runAction('slower') } // S

        return false;
      }, true);

      document.addEventListener('DOMNodeInserted', function(event) {
        var node = event.target || null;
        if (node && node.nodeName === 'VIDEO') {
          new tc.videoController(node);
        }
      });

      var videoTags = document.getElementsByTagName('video');
      videoTags.forEach = Array.prototype.forEach;
      videoTags.forEach(function(video) {
        var control = new tc.videoController(video);
      });
    }
  }, 10);
});
