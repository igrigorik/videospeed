chrome.runtime.sendMessage({}, function(response) {
 var vas=[];
 var rem="0:00:00";
 
"use strict";(function(root,factory){if(typeof define==="function"&&define.amd){define([],factory)}else if(typeof module==="object"&&module.exports){module.exports=factory()}else{root.balanceText=factory()}})(this,function(){function isArray(arg){if(Array.isArray){return Array.isArray(arg)}return Object.prototype.toString.call(arg)==="[object Array]"}function ready(fn){if(document.readyState!=="loading"){fn()}else if(document.addEventListener){document.addEventListener("DOMContentLoaded",fn)}else{document.attachEvent("onreadystatechange",function(){if(document.readyState!=="loading"){fn()}})}}function trigger(el,eventName,data){var event;if(window.CustomEvent){event=new CustomEvent(eventName,{detail:data})}else{event=document.createEvent("CustomEvent");event.initCustomEvent(eventName,true,true,data)}el.dispatchEvent(event)}function debounce(func,threshold,execAsap){var timeout;return function debounced(){var obj=this,args=arguments;function delayed(){if(!execAsap){func.apply(obj,args)}timeout=null}if(timeout){clearTimeout(timeout)}else if(execAsap){func.apply(obj,args)}timeout=setTimeout(delayed,threshold||100)}}function smartresize(fn){if(fn){window.addEventListener("resize",debounce(fn))}else{trigger(window,"smartresize")}}function nodeListAsArray(nodeList){return nodeList?Array.prototype.slice.call(nodeList):[]}function hasTextWrap(){var style=document.documentElement.style;return style.textWrap||style.WebkitTextWrap||style.MozTextWrap||style.MsTextWrap||style.OTextWrap}var wsMatches;function NextWS_params(){this.reset()}NextWS_params.prototype.reset=function(){this.index=0;this.width=0};var isWS=function(txt,index){var re=/\s(?![^<]*>)/g,match;if(!wsMatches){wsMatches=[];match=re.exec(txt);while(match!==null){wsMatches.push(match.index);match=re.exec(txt)}}return wsMatches.indexOf(index)!==-1};var removeTags=function(el){var brs=nodeListAsArray(el.querySelectorAll('br[data-owner="balance-text"]'));brs.forEach(function(br){br.outerHTML=" "});var spans=nodeListAsArray(el.querySelectorAll('span[data-owner="balance-text"]'));if(spans.length>0){var txt="";spans.forEach(function(span){txt+=span.textContent;span.parentNode.removeChild(span)});el.innerHTML=txt}};var isJustified=function(el){var style=el.currentStyle||window.getComputedStyle(el,null);return style.textAlign==="justify"};var justify=function(el,txt,conWidth){txt=txt.trim();var words=txt.split(" ").length;txt=txt+" ";if(words<2){return txt}var tmp=document.createElement("span");tmp.innerHTML=txt;el.appendChild(tmp);var size=tmp.offsetWidth;tmp.parentNode.removeChild(tmp);var wordSpacing=Math.floor((conWidth-size)/(words-1));tmp.style.wordSpacing=wordSpacing+"px";tmp.setAttribute("data-owner","balance-text");var div=document.createElement("div");div.appendChild(tmp);return div.innerHTML};var isBreakOpportunity=function(txt,index){return index===0||index===txt.length||isWS(txt,index-1)&&!isWS(txt,index)};var findBreakOpportunity=function(el,txt,conWidth,desWidth,dir,c,ret){var w;if(txt&&typeof txt==="string"){for(;;){while(!isBreakOpportunity(txt,c)){c+=dir}el.innerHTML=txt.substr(0,c);w=el.offsetWidth;if(dir<0){if(w<=desWidth||w<=0||c===0){break}}else{if(desWidth<=w||conWidth<=w||c===txt.length){break}}c+=dir}}ret.index=c;ret.width=w};var getSpaceWidth=function(el,h){var container=document.createElement("div");container.style.display="block";container.style.position="absolute";container.style.bottom=0;container.style.right=0;container.style.width=0;container.style.height=0;container.style.margin=0;container.style.padding=0;container.style.visibility="hidden";container.style.overflow="hidden";var space=document.createElement("span");space.style.fontSize="2000px";space.innerHTML="&nbsp;";container.appendChild(space);el.appendChild(container);var dims=space.getBoundingClientRect();container.parentNode.removeChild(container);var spaceRatio=dims.height/dims.width;return h/spaceRatio};var watching={sel:[],el:[]};function ensureElementArray(elements){if(NodeList.prototype.isPrototypeOf(elements)){elements=nodeListAsArray(elements)}if(!isArray(elements)){elements=[elements]}return elements}function balanceText(elements){if(hasTextWrap()){return this}if(typeof elements==="string"){elements=document.querySelectorAll(elements)}elements=ensureElementArray(elements);return elements.forEach(function(el){var maxTextWidth=5e3;removeTags(el);var oldWS=el.style.whiteSpace;var oldFloat=el.style.float;var oldDisplay=el.style.display;var oldPosition=el.style.position;var oldLH=el.style.lineHeight;el.style.lineHeight="normal";var containerWidth=el.offsetWidth;var containerHeight=el.offsetHeight;el.style.whiteSpace="nowrap";el.style.float="none";el.style.display="inline";el.style.position="static";var nowrapWidth=el.offsetWidth;var nowrapHeight=el.offsetHeight;var spaceWidth=oldWS==="pre-wrap"?0:getSpaceWidth(el,nowrapHeight);if(containerWidth>0&&nowrapWidth>containerWidth&&nowrapWidth<maxTextWidth){var remainingText=el.innerHTML;var newText="";var lineText="";var shouldJustify=isJustified(el);var totLines=Math.round(containerHeight/nowrapHeight);var remLines=totLines;var desiredWidth,guessIndex,le,ge,splitIndex;while(remLines>1){wsMatches=null;desiredWidth=Math.round((nowrapWidth+spaceWidth)/remLines-spaceWidth);guessIndex=Math.round((remainingText.length+1)/remLines)-1;le=new NextWS_params;findBreakOpportunity(el,remainingText,containerWidth,desiredWidth,-1,guessIndex,le);ge=new NextWS_params;guessIndex=le.index;findBreakOpportunity(el,remainingText,containerWidth,desiredWidth,+1,guessIndex,ge);le.reset();guessIndex=ge.index;findBreakOpportunity(el,remainingText,containerWidth,desiredWidth,-1,guessIndex,le);if(le.index===0){splitIndex=ge.index}else if(containerWidth<ge.width||le.index===ge.index){splitIndex=le.index}else{splitIndex=Math.abs(desiredWidth-le.width)<Math.abs(ge.width-desiredWidth)?le.index:ge.index}lineText=remainingText.substr(0,splitIndex);if(shouldJustify){newText+=justify(el,lineText,containerWidth)}else{newText+=lineText.replace(/\s$/,"");newText+='<br data-owner="balance-text" />'}remainingText=remainingText.substr(splitIndex);remLines--;el.innerHTML=remainingText;nowrapWidth=el.offsetWidth}if(shouldJustify){el.innerHTML=newText+justify(el,remainingText,containerWidth)}else{el.innerHTML=newText+remainingText}}el.style.whiteSpace=oldWS;el.style.float=oldFloat;el.style.display=oldDisplay;el.style.position=oldPosition;el.style.lineHeight=oldLH})}function applyBalanceText(){var selectors=watching.sel.join(",");var selectedElements=selectors?document.querySelectorAll(selectors):[];var elements=watching.el.concat(nodeListAsArray(selectedElements));balanceText(elements)}var handlersInitialized=false;function initHandlers(){if(handlersInitialized){return}ready(applyBalanceText);smartresize(applyBalanceText);handlersInitialized=true}function balanceTextAndWatch(elements){if(typeof elements==="string"){watching.sel.push(elements)}else{elements=ensureElementArray(elements);elements.forEach(function(el){watching.el.push(el)})}initHandlers();applyBalanceText()}var polyfilled=false;function polyfill(){if(polyfilled){return}watching.sel.push(".balance-text");initHandlers();polyfilled=true}function publicInterface(elements,options){if(!elements){polyfill();return}if(typeof elements!=="string"&&elements.length!==undefined){elements=nodeListAsArray(elements)}if(options&&options.watch){balanceTextAndWatch(elements);return}balanceText(elements)}publicInterface.updateWatched=function(){applyBalanceText()};return publicInterface});

 function cd_s_hmmss(s){
	 
	 var ss="00";
	 var mm="00"
	 var hh="";
	 
	 var hours = Math.floor(Math.ceil(s)/3600);
	 if(hours>0){
	 hh=hours+":";
	 }
	 
	var mins=Math.floor((Math.ceil(s)-hours*3600)/60);
	
	 if (mins<10){
		 mm="0"+mins;
	 }else{
		 mm=mins;
	 }
	 var secs=Math.ceil(s-hours*3600-mins*60);
	 
	 	 if (secs<10){
		 ss="0"+secs;
	 }else{
		 ss=secs;
	 }
	 
	 return hh+mm+":"+ss
 }
 
 
 
  var tc = {
    settings: {
      speed: 1.0,           // default 1x
      resetSpeed: 1.0,      // default 1x
      speedStep: 0.1,       // default 0.1x
      fastSpeed: 1.8,       // default 1.8x
      rewindTime: 10,       // default 10s
      advanceTime: 10,      // default 10s
      resetKeyCode:  82,    // default: R
      slowerKeyCode: 83,    // default: S
      fasterKeyCode: 68,    // default: D
      rewindKeyCode: 90,    // default: Z
      advanceKeyCode: 88,   // default: X
      displayKeyCode: 86,   // default: V
      fastKeyCode: 71,      // default: G
      rememberSpeed: false, // default: false
      startHidden: false,   // default: false
      blacklist: `
        www.instagram.com
        twitter.com
        vine.co
        imgur.com
      `.replace(/^\s+|\s+$/gm,'')
    }
  };


      function checkForVideo(node, parent, added) {
  if (node.classList!=undefined){
		            if (node.classList.contains('vsc-initialized')) {
            let id = node.dataset['vscid'];
            let ctrl = document.querySelector(`div[data-vscid="${id}"]`)
              if (ctrl) {
            ctrl.remove();
             }
              node.classList.remove('vsc-initialized');
              delete node.dataset['vscid'];
            }
	  }
        if (node.nodeName === 'VIDEO' || node.nodeName === 'AUDIO') {

if(node.src.length>0){
			vas=[];
          if (added) {
            new tc.videoController(node, parent);
			//console.log(tc.videoController);
          }
		}
        } 
		
 if (node.children != undefined) {
          for (var i = 0; i < node.children.length; i++) {
            checkForVideo(node.children[i],
                          node.children[i].parentNode || parent,
                          added);
						 
          }  
        }
      }
	  
   
  chrome.storage.sync.get(tc.settings, function(storage) {
    tc.settings.speed = Number(storage.speed);
    tc.settings.resetSpeed = Number(storage.resetSpeed);
    tc.settings.speedStep = Number(storage.speedStep);
    tc.settings.fastSpeed = Number(storage.fastSpeed);
    tc.settings.rewindTime = Number(storage.rewindTime);
    tc.settings.advanceTime = Number(storage.advanceTime);
    tc.settings.resetKeyCode = Number(storage.resetKeyCode);
    tc.settings.rewindKeyCode = Number(storage.rewindKeyCode);
    tc.settings.slowerKeyCode = Number(storage.slowerKeyCode);
    tc.settings.fasterKeyCode = Number(storage.fasterKeyCode);
    tc.settings.fastKeyCode = Number(storage.fastKeyCode);
    tc.settings.displayKeyCode = Number(storage.displayKeyCode);
    tc.settings.advanceKeyCode = Number(storage.advanceKeyCode);
    tc.settings.rememberSpeed = Boolean(storage.rememberSpeed);
    tc.settings.startHidden = Boolean(storage.startHidden);
    tc.settings.blacklist = String(storage.blacklist);

    initializeWhenReady(document);
  });


	  var forEach = Array.prototype.forEach;
	  
	var subti = {
dom:0,
subtitle:0,
subs1:0
}

	var s={
		subtitles:0,
		update:0,
		subcount:0,
		d:0
	}

function sbx(v){
	
  function useInnerText() {
                var oDiv =subti.dom;
                var aDiv = subti.subtitle;
                aDiv.innerHTML=oDiv.value;
            }
		
function videosub_timecode_min(tc) {
	tcpair = tc.split(' --> ');
	return videosub_tcsecs(tcpair[0]);
}
function videosub_timecode_max(tc) {
	tcpair = tc.split(' --> ');
	return videosub_tcsecs(tcpair[1]);
}
function videosub_tcsecs(tc) {
	tc1 = tc.split(',');
	tc2 = tc1[0].split(':');
	secs = Math.floor(tc2[0]*60*60) + Math.floor(tc2[1]*60) + Math.floor(tc2[2]) + (Math.floor(tc1[1])/1000)+ (s.d/1000);
	return secs;
}


function videosub_main() {


			s.update = function(req) {
				s.subtitles = new Array();
				records = req.replace('\r', '').split('\n\n');
				for (var r=0;r<records.length;r++) {
					record = records[r];
					s.subtitles[r] = new Array();
					s.subtitles[r] = record.split('\n');
				}
			}

			// load the subtitle file

			s.update(subti.subtitle.innerHTML.trim());
			s.subcount = 0;


//);
}



	  
	  v.addEventListener('seeked', function(event) {

subtitleDispSk();
s.subcount = 0;
				while (videosub_timecode_max(s.subtitles[s.subcount][1]) < v.currentTime) {
					s.subcount++;
					if (s.subcount > s.subtitles.length-1) {
						s.subcount = s.subtitles.length-1;
						break;
					}
				}
			});
			
			
			
v.addEventListener('seeking', function(event) {

subtitleDispSk();
s.subcount = 0;
				while (videosub_timecode_max(s.subtitles[s.subcount][1]) < v.currentTime) {
					s.subcount++;
					if (s.subcount > s.subtitles.length-1) {
						s.subcount = s.subtitles.length-1;
						break;
					}
				}
				});

function subtitleDisp(){ 

var subRefresh= setInterval(function (){
  if (!v.paused) {
var subtitleCurr = '';


if (v.currentTime >= videosub_timecode_min(s.subtitles[s.subcount][1])  &&  v.currentTime <= videosub_timecode_max(s.subtitles[s.subcount][1])) {
					subtitleCurr = s.subtitles[s.subcount].slice(2).join('<br>');

subti.subs1.innerHTML= subtitleCurr;
   balanceText.updateWatched();

}

			if (v.currentTime > videosub_timecode_max(s.subtitles[s.subcount][1])  && s.subcount < (s.subtitles.length-1)) {
					s.subcount++;
				}
  }
  
  else{
  clearInterval(subRefresh);
  }
  
}, 1);}

function subtitleDispSk(){ 


var subtitleCurr = '';


if (v.currentTime >= videosub_timecode_min(s.subtitles[s.subcount][1])  &&  s.currentTime <= videosub_timecode_max(s.subtitles[s.subcount][1])) {
					subtitleCurr = s.subtitles[s.subcount].slice(2).join('<br>');

subti.subs1.innerHTML= subtitleCurr;
    balanceText.updateWatched();

}

			if (v.currentTime > videosub_timecode_max(s.subtitles[s.subcount][1])  && s.subcount < (s.subtitles.length-1)) {
					s.subcount++;
				}
  }


	if (subti.dom==0 || subti.dom.value=="" ){
	wx = window.innerWidth;
wy = window.innerHeight;


	
	var s_link = document.createElement('link');
s_link.setAttribute('rel', 'stylesheet');
s_link.type = 'text/css';
s_link.href = chrome.extension.getURL('shadow.css');
document.body.appendChild(s_link);


subti.dom=document.createElement('textarea');
document.body.appendChild(subti.dom);
subti.dom.id="subti";

subti.dom.style.top=wy/2+"px";

subti.dom.style.left = wx/2+"px";
	}
	
	else{
		alert('subs loaded!');
		subti.dom.style.display="none";
		
		//<div class="balance-text" id="subs1"></div>
 //document.write('<script type="text/srt" id="subtitle"></script>');
subti.subtitle = document.createElement('script');
subti.subtitle.type="text/srt";
subti.subtitle.id="subtitle";
document.body.appendChild(subti.subtitle);

subti.subs1=document.createElement('div');
subti.subs1.className="balance-text";
		subti.subs1.id="subs1";
	  	  
	subti.subs1.addEventListener('mousewheel', function(event){

  if(event.deltaY < 0){
	  
	  if (event.ctrlKey) {
        	s.d+=20;
	console.log('Delayed by '+s.d+' ms')
        alert('wheel');
    }else{
	 s.d+=100;
	console.log('Delayed by '+s.d+' ms')
	event.preventDefault();
	}
  }
  else if(event.deltaY > 0) {
	  
	  if (event.ctrlKey) {
        	s.d-=20;
	console.log('Delayed by '+s.d+' ms')
        alert('wheel');
    }else{
		s.d-=100;
	console.log('Delayed by '+s.d+' ms')
	event.preventDefault();
  }
  }
  else{
  	return;
  }
},false);

		
document.body.appendChild(subti.subs1);
		
		function sub() {
useInnerText();
videosub_main();
subtitleDisp();
v.play();
}

			sub();


		
	}
	
	
}
 
  function defineVideoController() {
    tc.videoController = function(target, parent) {
			//console.log(tc.videoController);
      if (target.dataset['vscid']) {
        return;
      }
//console.log(this);
      this.video = target;
	  console.log(target);
	  	vas.push(target);
		console.log(vas);
      this.parent = target.parentElement || parent;
      this.document = target.ownerDocument;
      this.id = Math.random().toString(36).substr(2, 9);
      if (!tc.settings.rememberSpeed) {
        tc.settings.speed = 1.0;
        tc.settings.resetSpeed = tc.settings.fastSpeed;
      }
      this.initializeControls();
			//  console.log(target);
			
				target.style.filter='blur(0px) saturate(1.002) hue-rotate(0deg) brightness(1) contrast(1.004) invert(0) sepia(0)';
						
						target.style.webkitFilter ='blur(0px) saturate(1.002) hue-rotate(0deg) brightness(1) contrast(1.004) invert(0) sepia(0)';


      target.addEventListener('play', function(event) {
        target.playbackRate = tc.settings.speed;
	
      });
	  


      target.addEventListener('timeupdate', function(event) {
        rem = (target.duration-target.currentTime)/target.playbackRate;

          var speed = this.getSpeed();
		  rem=cd_s_hmmss(rem);
          this.speedIndicator.textContent = speed + " | " + rem;
      }.bind(this));

      target.addEventListener('ratechange', function(event) {


        if (event.target.readyState > 0) {
          rem = (target.duration-target.currentTime)/target.playbackRate;
          var speed = this.getSpeed();
		  rem=cd_s_hmmss(rem);
          this.speedIndicator.textContent = speed + " | " + rem;
          tc.settings.speed = speed;
          chrome.storage.sync.set({'speed': speed}, function() {
            console.log('Speed setting saved: ' + speed);
          });
        }

      }.bind(this));

      target.playbackRate = tc.settings.speed;
    };

    tc.videoController.prototype.getSpeed = function() {
      return parseFloat(this.video.playbackRate).toFixed(2);
    }

    tc.videoController.prototype.remove = function() {
      this.parentElement.removeChild(this);
    }

    tc.videoController.prototype.initializeControls = function() {
      var document = this.document;
      var speed = parseFloat(tc.settings.speed).toFixed(2),
        top = Math.max(this.video.offsetTop, 0) + "px",
        left = Math.max(this.video.offsetLeft, 0) + "px";

      var prevent = function(e) {
        e.preventDefault();
        e.stopPropagation();
      }

      var wrapper = document.createElement('div');
      wrapper.classList.add('vsc-controller');
      wrapper.dataset['vscid'] = this.id;
      wrapper.addEventListener('dblclick', prevent, true);
      wrapper.addEventListener('mousedown', prevent, true);
      wrapper.addEventListener('click', prevent, true);

	  
      if (tc.settings.startHidden) {
        wrapper.classList.add('vsc-hidden');
      }

      var shadow = wrapper.createShadowRoot();
      var shadowTemplate = `
        <style>
          @import "${chrome.runtime.getURL('shadow.css')}";
        </style>

        <div id="controller" class= "vsc_ctl_mod" style="top:${top}; left:${left}">
	<span data-action="drag" class="draggable">${speed} | ${rem}</span>
          <span id="controls">
            <button  class= "vsc_btn_mod" data-action="rewind" class="rw">«</button>
            <button class= "vsc_btn_mod" data-action="slower">-</button>
            <button class= "vsc_btn_mod" data-action="faster">+</button>
            <button class= "vsc_btn_mod" data-action="advance" class="rw">»</button>
            <button class= "vsc_btn_mod" data-action="display" class="hideButton">x</button>
			<button class= "vsc_btn_mod" data-action="subs">_</button>
			<button class= "vsc_btn_mod" data-action="rescan">O</button>
          </span>
        </div>

      `;
      shadow.innerHTML = shadowTemplate;
      shadow.querySelector('.draggable').addEventListener('mousedown', (e) => {
        runAction(e.target.dataset['action'], document);
      });
	
	  	  
shadow.addEventListener('mousewheel', function(event){

  if(event.deltaY < 0){
	runAction('faster', document, true);
	event.preventDefault();
  }
  else if(event.deltaY > 0) {
	runAction('slower', document, true);
	event.preventDefault();
  }
  else{
  	return;
  }
},false);


      forEach.call(shadow.querySelectorAll('button'), function(button) {
        button.onclick = (e) => {
          runAction(e.target.dataset['action'], document);
        }
      });

      this.speedIndicator = shadow.querySelector('span');
      var fragment = document.createDocumentFragment();
      fragment.appendChild(wrapper);

      this.video.classList.add('vsc-initialized');
      this.video.dataset['vscid'] = this.id;

      switch (true) {
        case (location.hostname == 'www.amazon.com'):
        case (/hbogo\./).test(location.hostname):
          // insert before parent to bypass overlay
          this.parent.parentElement.insertBefore(fragment, this.parent);
          break;

        default:
          // Note: when triggered via a MutationRecord, it's possible that the
          // target is not the immediate parent. This appends the controller as
          // the first element of the target, which may not be the parent.
          this.parent.insertBefore(fragment, this.parent.firstChild);
      }

    }

  }

  
  function initializeWhenReady(document) {
    escapeStringRegExp.matchOperatorsRe = /[|\\{}()[\]^$+*?.]/g;
    function escapeStringRegExp(str) {
      return str.replace(escapeStringRegExp.matchOperatorsRe, '\\$&');
    }

    var blacklisted = false;
    tc.settings.blacklist.split("\n").forEach(match => {
      match = match.replace(/^\s+|\s+$/g,'')
      if (match.length == 0) {
        return;
      }

      var regexp = new RegExp(escapeStringRegExp(match));
      if (regexp.test(location.href)) {
        blacklisted = true;
        return;
      }
    })

    if (blacklisted)
      return;

    window.onload = () => initializeNow(document);
    if (document) {
      if (document.readyState === "complete") {
        initializeNow(document);
      } else {
        document.onreadystatechange = () => {
          if (document.readyState === "complete") {
            initializeNow(document);
          }
        }
      }
    }
  }
 
  function initializeNow(document) {
      // enforce init-once due to redundant callers
      if (document.body.classList.contains('vsc-initialized')) {
        return;
      }
      document.body.classList.add('vsc-initialized');

      if (document === window.document) {
        defineVideoController();
      } else {
        var link = document.createElement('link');
        link.href = chrome.runtime.getURL('inject.css');
        link.type = 'text/css';
        link.rel = 'stylesheet';
        document.head.appendChild(link);
      }

      document.addEventListener('keydown', function(event) {
        var keyCode = event.keyCode;

				 if (event.getModifierState("Alt")){
			 if (keyCode == 49) {runAction('one', document, true);}
		     else if (keyCode == 50) {runAction('two', document, true);}
			 else if (keyCode == 51) {runAction('three', document, true);}
			 else if (keyCode == 52) {runAction('four', document, true);}
			 else if (keyCode == 53) {runAction('five', document, true);}
			 else if (keyCode == 54) {runAction('six', document, true);}
			 else if (keyCode == 55) {runAction('seven', document, true);}
			 else if (keyCode == 56) {runAction('eight', document, true);}
			 else if (keyCode == 57) {runAction('nine', document, true);}
			 else if (keyCode == 223) {runAction('switch', document, true);}
			 else if (keyCode == tc.settings.rewindKeyCode) {runAction('rewind', document, true)} 
			 else if (keyCode == tc.settings.advanceKeyCode) {runAction('advance', document, true)}
			 else if (keyCode == 66) {runAction('playPause', document, true)};
		}
		
		
		
        // Ignore if following modifier is active.
        if (!event.getModifierState
            || event.getModifierState("Alt")
            || event.getModifierState("Control")
            || event.getModifierState("Fn")
            || event.getModifierState("Meta")
            || event.getModifierState("Hyper")
            || event.getModifierState("OS")) {
          return;
        }

        // Ignore keydown event if typing in an input box
        if ((document.activeElement.nodeName === 'INPUT'
              && document.activeElement.getAttribute('type') === 'text')
            || document.activeElement.nodeName === 'TEXTAREA'
            || document.activeElement.isContentEditable) {
          return false;
        }

        if (keyCode == tc.settings.rewindKeyCode) {
          runAction('rewind', document, true)
        } else if (keyCode == tc.settings.advanceKeyCode) {
          runAction('advance', document, true)
        } else if (keyCode == tc.settings.fasterKeyCode) {
          runAction('faster', document, true)
        } else if (keyCode == tc.settings.slowerKeyCode) {
          runAction('slower', document, true)
        } else if (keyCode == tc.settings.resetKeyCode) {
          runAction('reset', document, true)
        } else if (keyCode == tc.settings.displayKeyCode) {
          runAction('display', document, true)
        } else if (keyCode == tc.settings.fastKeyCode) {
          runAction('fast', document, true);
        }

        return false;
      }, true);

	  
	   
      var observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
          forEach.call(mutation.addedNodes, function(node) {
            if (typeof node === "function")
              return;
            checkForVideo(node, node.parentNode || mutation.target, true);
          })
          forEach.call(mutation.removedNodes, function(node) {
            if (typeof node === "function")
              return;
            checkForVideo(node, node.parentNode || mutation.target, false);
          })
        });
      });
      observer.observe(document, { childList: true, subtree: true });

	  	var videoTags = [
    ...document.getElementsByTagName('video'),
    ...document.getElementsByTagName('audio')
];
	  
      forEach.call(videoTags, function(video) {
        new tc.videoController(video);
      });
	  

      var frameTags = document.getElementsByTagName('iframe');
      forEach.call(frameTags, function(frame) {
        // Ignore frames we don't have permission to access (different origin).
        try { var childDocument = frame.contentDocument } catch (e) { return }
        initializeWhenReady(childDocument);
      });
  }
			var pR1=1;
			
  function runAction(action, document, keyboard) {  
	  
	
	var videoTags = [
    ...document.getElementsByTagName('video'),
    ...document.getElementsByTagName('audio')
];
//	];
	
    videoTags.forEach = Array.prototype.forEach;

    videoTags.forEach(function(v) {


	
      var id = v.dataset['vscid'];
	   if (id != undefined) {
      var controller = document.querySelector(`div[data-vscid="${id}"]`);

      showController(controller);
	  

      if (!v.classList.contains('vsc-cancelled')) {
        if (action === 'rewind') {
          v.currentTime -= tc.settings.rewindTime;
        } else if (action === 'advance') {
          v.currentTime += tc.settings.advanceTime;
		}else if (action === 'playPause') {
				if(v.paused){
					v.play();
					}	
				else{
					v.pause(); 
					} 
			}else if(action === 'rescan'){	

		
		   //   forEach.call(videoTags, function(video) {
     // new tc.videoController(video);
	  //checkForVideo(video, video.parentNode, true);
  //    });
	  

			var tgs=document.getElementsByTagName("*");
			
 Array.prototype.forEach.call(tgs, i => {

	  checkForVideo(i, i.parentNode, true);
 });

}else if(action === 'subs'){
sbx(v);
}
else if (action === 'faster') {
          // Maximum playback speed in Chrome is set to 16:
          // https://cs.chromium.org/chromium/src/media/blink/webmediaplayer_impl.cc?l=103
          var s = Math.min( (v.playbackRate < 0.1 ? 0.0 : v.playbackRate) + tc.settings.speedStep, 16);
          v.playbackRate = Number(s.toFixed(2));
        } else if (action === 'slower') {
          // Audio playback is cut at 0.05:
          // https://cs.chromium.org/chromium/src/media/filters/audio_renderer_algorithm.cc?l=49
          // Video min rate is 0.0625:
          // https://cs.chromium.org/chromium/src/media/blink/webmediaplayer_impl.cc?l=102
          var s = Math.max(v.playbackRate - tc.settings.speedStep, 0.0625);
          v.playbackRate = Number(s.toFixed(2));
        } else if (action === 'one') {
			v.playbackRate=1;
        } else if (action === 'two') {
			v.playbackRate=2;
        } else if (action === 'three') {
			v.playbackRate=3;
        } else if (action === 'four') {
			v.playbackRate=4;
        } else if (action === 'five') {
			v.playbackRate=5;
        } else if (action === 'six') {
			v.playbackRate=6;
        } else if (action === 'seven') {
			v.playbackRate=7;
        } else if (action === 'eight') {
			v.playbackRate=8;
        } else if (action === 'nine') {
			v.playbackRate=9;
        } else if (action === 'switch') {
			  if (v.playbackRate!=1) {
			pR1=v.playbackRate;
v.playbackRate=1;
			  } else{
				  v.playbackRate=pR1;
				pR1=1;
			  }
			  
        } else if (action === 'reset') {
          resetSpeed(v, 1.0);
        } else if (action === 'display') {
          controller.classList.add('vsc-manual');
          controller.classList.toggle('vsc-hidden');
        } else if (action === 'drag') {
          handleDrag(v, controller);
        } else if (action === 'fast') {
          resetSpeed(v, tc.settings.fastSpeed);
        }
      }
	}
    });
  }
  
  function resetSpeed(v, target) {
    if (v.playbackRate === target) {
      v.playbackRate = tc.settings.resetSpeed;
    } else {
      tc.settings.resetSpeed = v.playbackRate;
      chrome.storage.sync.set({'resetSpeed': v.playbackRate});
      v.playbackRate = target;
    }
  }
  
 function handleDrag(video, controller) {
    const parentElement = controller.parentElement,
      shadowController = controller.shadowRoot.querySelector('#controller');

    video.classList.add('vcs-dragging');
    shadowController.classList.add('dragging');

    const startDragging = (e) => {
      let style = shadowController.style;
      style.left = parseInt(style.left) + e.movementX + 'px';
      style.top  = parseInt(style.top)  + e.movementY + 'px';
    }

    const stopDragging = () => {
      parentElement.removeEventListener('mousemove', startDragging);
      parentElement.removeEventListener('mouseup', stopDragging);
      parentElement.removeEventListener('mouseleave', stopDragging);

      shadowController.classList.remove('dragging');
      video.classList.remove('vcs-dragging');
    }

    parentElement.addEventListener('mouseup',stopDragging);
    parentElement.addEventListener('mouseleave',stopDragging);
    parentElement.addEventListener('mousemove', startDragging);
  }
 
  var timer;
  var animation = false;
  
  function showController(controller) { 
    controller.classList.add('vcs-show');

    if (animation)
      clearTimeout(timer);

    animation = true;
    timer = setTimeout(function() {
      controller.classList.remove('vcs-show');
      animation = false;
    }, 2000);
  }
 
});

