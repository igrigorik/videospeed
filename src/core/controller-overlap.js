const players = new WeakMap();

function overlaps(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

class PlayerControllers {
  constructor(player) {
    this.player = player;
    this.controllers = new Set();
  }

  add(controller) {
    this.controllers.add(controller);
    this.update(true);
  }

  remove(controller) {
    this.controllers.delete(controller);
    this.update(true);
  }

  isAttached(controller) {
    return controller.div.isConnected && this.player.contains(controller.video);
  }

  hasPlayingVideo() {
    for (const controller of this.controllers) {
      const { video } = controller;
      if (!video.paused && !video.ended && this.isAttached(controller)) {
        return true;
      }
    }
    return false;
  }

  observe() {
    const refresh = () => this.update();
    this.mutations = new MutationObserver(refresh);
    this.resize = typeof ResizeObserver === 'function' ? new ResizeObserver(refresh) : null;
    const observed = new Set();
    for (const { div, panel } of this.controllers) {
      this.resize?.observe(panel);
      this.mutations.observe(panel, { attributeFilter: ['class', 'style'] });
      for (
        let node = div;
        node && !observed.has(node);
        node = node.parentElement || node.getRootNode().host
      ) {
        observed.add(node);
        this.resize?.observe(node);
        this.mutations.observe(node, {
          attributeFilter: ['class', 'style', 'hidden', 'data-vsc-visibility'],
          childList: true,
        });
      }
    }
    if (!observed.has(this.player)) {
      this.mutations.observe(this.player, { childList: true });
    }
  }

  disconnect() {
    this.mutations?.disconnect();
    this.resize?.disconnect();
    this.mutations = null;
    this.resize = null;
  }

  update(membershipChanged = false) {
    const ended = [];
    const available = [];
    for (const controller of this.controllers) {
      const attached = this.isAttached(controller);
      if (attached && controller.video.ended) {
        ended.push(controller);
      } else {
        controller.div.removeAttribute('data-vsc-overlap-hidden');
        if (attached) {
          available.push(controller);
        }
      }
    }

    const hasCompetition = ended.length > 0 && available.length > 0;
    if (membershipChanged || !hasCompetition) {
      this.disconnect();
    }
    if (hasCompetition && !this.mutations) {
      this.observe();
    }

    const rendered = ended.length
      ? available
          .filter(({ actionHandler, div }) => actionHandler?.isControllerVisible?.(div))
          .map(({ panel }) => panel.getBoundingClientRect())
          .filter((rect) => rect.width > 0 && rect.height > 0)
      : [];
    for (const { div, panel } of ended) {
      const rect = panel.getBoundingClientRect();
      const hidden =
        rect.width > 0 && rect.height > 0 && rendered.some((other) => overlaps(rect, other));
      div.toggleAttribute('data-vsc-overlap-hidden', hidden);
    }
  }
}

export function trackControllerOverlap(controller) {
  const { video } = controller;
  const selectors = window.VSC.siteHandlerManager.getVideoContainerSelectors();
  let player = null;
  for (const selector of selectors) {
    player = video.closest(selector);
    if (player) {
      break;
    }
  }
  player ??= video.parentNode;
  if (!player) {
    return null;
  }

  let group = players.get(player);
  if (!group) {
    group = new PlayerControllers(player);
    players.set(player, group);
  }
  group.add(controller);
  return group;
}
