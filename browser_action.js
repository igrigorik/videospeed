(function () {

  var video_speed = (function () {

    var common_speed;

    function set_speed(speed) {
      speed = parseFloat(Math.round(speed * 100) / 100);
      chrome.storage.sync.set({'speed': speed});
      common_speed = speed;
    }

    function initialize(callback) {
      chrome.storage.sync.get('speed', function (storage) {
        if (storage.speed) {
          common_speed = storage.speed;
        } else {
          set_speed(1.00);
        }
        callback(common_speed);
      });
    }

    function increase() {
      set_speed(common_speed + 0.10);
      return common_speed;
    }

    function decrease() {
      set_speed(common_speed - 0.10);
      return common_speed;
    }

    return {
      initialize: initialize,
      increase: increase,
      decrease: decrease
    };

  })();

  var current_speed = document.getElementById('current-video-speed'),
    speed_controls = document.getElementsByTagName('button');

  speed_controls.forEach = Array.prototype.forEach;

  video_speed.initialize(function (speed) {
    current_speed.innerHTML = speed.toFixed(2);
  });

  speed_controls.forEach(function (speed_control) {
    speed_control.addEventListener('click', function (event) {
      var speed, control = event.target.attributes['data-control'].value;
      if (control === 'increase') {
        speed = video_speed.increase();
      } else {
        speed = video_speed.decrease();
      }

      current_speed.innerHTML = speed.toFixed(2);
    });
  });

})();