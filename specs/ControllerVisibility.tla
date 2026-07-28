------------------------- MODULE ControllerVisibility -------------------------
(***************************************************************************)
(* Formal model of VSC's controller-visibility contract.                  *)
(*                                                                         *)
(* Visibility is per controller, but keyboard/popup display commands are   *)
(* document-wide broadcasts. The model therefore uses two controllers: a   *)
(* video (timed flash) and an audio element (persistent flash). It checks   *)
(* both local non-interference and independent broadcast transitions.       *)
(* The first toggle samples AUTO rendering; later toggles alternate explicit *)
(* SHOW/HIDE intent, which remains manual until controller release.          *)
(*                                                                         *)
(* Rendering is a precedence relation, not a mutable variable:              *)
(*                                                                         *)
(*   external host hide / no source / FORCE_HIDE                            *)
(*     > FORCE_SHOW / flash                                                 *)
(*     > automatic media hide / site autohide                              *)
(*                                                                         *)
(* Timers use a bounded abstraction. TIMED_ARMED becomes TIMED_DUE, then    *)
(* expires. Repeated flash requests re-arm it; weak fairness prevents an    *)
(* armed or due timer from remaining stuck when the environment stops       *)
(* refreshing it. Actual milliseconds and DOM/CSS conformance are adapter   *)
(* refinements checked in JavaScript and real Chrome.                       *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS
  Controllers,
  AudioControllers

Auto == "AUTO"
Show == "SHOW"
Hide == "HIDE"
OverrideModes == {Auto, Show, Hide}

NoFlash == "NO_FLASH"
TimedArmed == "TIMED_ARMED"
TimedDue == "TIMED_DUE"
Persistent == "PERSISTENT"
FlashModes == {NoFlash, TimedArmed, TimedDue, Persistent}

ASSUME /\ Cardinality(Controllers) >= 2
       /\ AudioControllers \subseteq Controllers
       /\ AudioControllers # {}
       /\ Controllers \ AudioControllers # {}

VARIABLES
  attached,          \* [Controllers -> BOOLEAN]
  overrideMode,      \* [Controllers -> OverrideModes]
  automaticHidden,   \* startHidden / media-visibility automatic layer
  noSource,          \* media cannot currently render useful controls
  siteAutohide,      \* environment-owned player autohide state
  hostHidden,        \* external CSS hides the light-DOM controller host
  flashMode,          \* none, timed video flash, or persistent audio flash
  startHidden,        \* live document preference consulted by future events
  timerRefreshEnabled \* auxiliary: environment may stop re-arming video timer

vars ==
  <<attached, overrideMode, automaticHidden, noSource, siteAutohide,
    hostHidden, flashMode, startHidden, timerRefreshEnabled>>

Replace(f, i, value) == [j \in Controllers |-> IF j = i THEN value ELSE f[j]]

IsAudio(i) == i \in AudioControllers

HardHidden(i) ==
  ~attached[i] \/ hostHidden[i] \/ noSource[i] \/ overrideMode[i] = Hide

ForcedShown(i) == overrideMode[i] = Show \/ flashMode[i] # NoFlash

Visible(i) ==
  ~HardHidden(i) /\
  (ForcedShown(i) \/ (~automaticHidden[i] /\ ~siteAutohide[i]))

ToggleTarget(i) ==
  IF overrideMode[i] = Auto
    THEN IF Visible(i) THEN Hide ELSE Show
    ELSE IF overrideMode[i] = Show THEN Hide ELSE Show

FlashTarget(i) == IF IsAudio(i) THEN Persistent ELSE TimedArmed

FlashAllowed(i) == attached[i] /\ ~startHidden /\ overrideMode[i] # Hide

TypeOK ==
  /\ attached \in [Controllers -> BOOLEAN]
  /\ overrideMode \in [Controllers -> OverrideModes]
  /\ automaticHidden \in [Controllers -> BOOLEAN]
  /\ noSource \in [Controllers -> BOOLEAN]
  /\ siteAutohide \in [Controllers -> BOOLEAN]
  /\ hostHidden \in [Controllers -> BOOLEAN]
  /\ flashMode \in [Controllers -> FlashModes]
  /\ startHidden \in BOOLEAN
  /\ timerRefreshEnabled \in [Controllers -> BOOLEAN]

Init ==
  /\ startHidden \in BOOLEAN
  /\ attached = [i \in Controllers |-> TRUE]
  /\ overrideMode = [i \in Controllers |-> Auto]
  /\ automaticHidden \in [Controllers -> BOOLEAN]
  /\ startHidden => \A i \in Controllers : automaticHidden[i]
  /\ noSource \in [Controllers -> BOOLEAN]
  /\ siteAutohide \in [Controllers -> BOOLEAN]
  /\ hostHidden \in [Controllers -> BOOLEAN]
  /\ flashMode = [i \in Controllers |-> NoFlash]
  /\ timerRefreshEnabled = [i \in Controllers |-> ~IsAudio(i)]

(***************************************************************************)
(* User actions. ToggleOne models a targeted adapter action; ToggleAll is   *)
(* the keyboard/popup broadcast. Both sample Visible before clearing flash. *)
(***************************************************************************)
ToggleOne(i) ==
  /\ attached[i]
  /\ overrideMode' = Replace(overrideMode, i, ToggleTarget(i))
  /\ flashMode' = Replace(flashMode, i, NoFlash)
  /\ UNCHANGED <<attached, automaticHidden, noSource, siteAutohide,
                 hostHidden, startHidden, timerRefreshEnabled>>

ToggleAll ==
  /\ \E i \in Controllers : attached[i]
  /\ overrideMode' =
       [i \in Controllers |->
         IF attached[i] THEN ToggleTarget(i) ELSE overrideMode[i]]
  /\ flashMode' =
       [i \in Controllers |->
         IF attached[i] THEN NoFlash ELSE flashMode[i]]
  /\ UNCHANGED <<attached, automaticHidden, noSource, siteAutohide,
                 hostHidden, startHidden, timerRefreshEnabled>>

FlashAttempt(i) ==
  /\ attached[i]
  /\ IsAudio(i) \/ timerRefreshEnabled[i]
  /\ flashMode' =
       Replace(flashMode, i, IF FlashAllowed(i) THEN FlashTarget(i) ELSE flashMode[i])
  /\ UNCHANGED <<attached, overrideMode, automaticHidden, noSource,
                 siteAutohide, hostHidden, startHidden, timerRefreshEnabled>>

TimerTick(i) ==
  /\ attached[i]
  /\ flashMode[i] = TimedArmed
  /\ flashMode' = Replace(flashMode, i, TimedDue)
  /\ UNCHANGED <<attached, overrideMode, automaticHidden, noSource,
                 siteAutohide, hostHidden, startHidden, timerRefreshEnabled>>

FlashExpire(i) ==
  /\ attached[i]
  /\ flashMode[i] = TimedDue
  /\ flashMode' = Replace(flashMode, i, NoFlash)
  /\ UNCHANGED <<attached, overrideMode, automaticHidden, noSource,
                 siteAutohide, hostHidden, startHidden, timerRefreshEnabled>>

StopTimerRefresh(i) ==
  /\ attached[i]
  /\ ~IsAudio(i)
  /\ timerRefreshEnabled[i]
  /\ timerRefreshEnabled' = Replace(timerRefreshEnabled, i, FALSE)
  /\ UNCHANGED <<attached, overrideMode, automaticHidden, noSource,
                 siteAutohide, hostHidden, flashMode, startHidden>>

(***************************************************************************)
(* Automatic and environment-owned inputs. None may rewrite explicit user  *)
(* intent or flash state. startHidden blocks future automatic-show and flash *)
(* events but, matching production, changing it does not retroactively hide *)
(* an existing controller or cancel an existing flash.                     *)
(***************************************************************************)
AutomaticHide(i) ==
  /\ attached[i]
  /\ ~automaticHidden[i]
  /\ automaticHidden' = Replace(automaticHidden, i, TRUE)
  /\ UNCHANGED <<attached, overrideMode, noSource, siteAutohide,
                 hostHidden, flashMode, startHidden, timerRefreshEnabled>>

AutomaticShow(i) ==
  /\ attached[i]
  /\ automaticHidden[i]
  /\ ~startHidden
  /\ automaticHidden' = Replace(automaticHidden, i, FALSE)
  /\ UNCHANGED <<attached, overrideMode, noSource, siteAutohide,
                 hostHidden, flashMode, startHidden, timerRefreshEnabled>>

SourceLost(i) ==
  /\ attached[i]
  /\ ~noSource[i]
  /\ noSource' = Replace(noSource, i, TRUE)
  /\ UNCHANGED <<attached, overrideMode, automaticHidden, siteAutohide,
                 hostHidden, flashMode, startHidden, timerRefreshEnabled>>

SourceGained(i) ==
  /\ attached[i]
  /\ noSource[i]
  /\ noSource' = Replace(noSource, i, FALSE)
  /\ UNCHANGED <<attached, overrideMode, automaticHidden, siteAutohide,
                 hostHidden, flashMode, startHidden, timerRefreshEnabled>>

SiteAutohideOn(i) ==
  /\ attached[i]
  /\ ~siteAutohide[i]
  /\ siteAutohide' = Replace(siteAutohide, i, TRUE)
  /\ UNCHANGED <<attached, overrideMode, automaticHidden, noSource,
                 hostHidden, flashMode, startHidden, timerRefreshEnabled>>

SiteAutohideOff(i) ==
  /\ attached[i]
  /\ siteAutohide[i]
  /\ siteAutohide' = Replace(siteAutohide, i, FALSE)
  /\ UNCHANGED <<attached, overrideMode, automaticHidden, noSource,
                 hostHidden, flashMode, startHidden, timerRefreshEnabled>>

HostHide(i) ==
  /\ attached[i]
  /\ ~hostHidden[i]
  /\ hostHidden' = Replace(hostHidden, i, TRUE)
  /\ UNCHANGED <<attached, overrideMode, automaticHidden, noSource,
                 siteAutohide, flashMode, startHidden, timerRefreshEnabled>>

HostShow(i) ==
  /\ attached[i]
  /\ hostHidden[i]
  /\ hostHidden' = Replace(hostHidden, i, FALSE)
  /\ UNCHANGED <<attached, overrideMode, automaticHidden, noSource,
                 siteAutohide, flashMode, startHidden, timerRefreshEnabled>>

SetStartHidden(value) ==
  /\ value \in BOOLEAN
  /\ value # startHidden
  /\ startHidden' = value
  /\ UNCHANGED <<attached, overrideMode, automaticHidden, noSource,
                 siteAutohide, hostHidden, flashMode, timerRefreshEnabled>>

Release(i) ==
  /\ attached[i]
  /\ attached' = Replace(attached, i, FALSE)
  /\ overrideMode' = Replace(overrideMode, i, Auto)
  /\ flashMode' = Replace(flashMode, i, NoFlash)
  /\ UNCHANGED <<automaticHidden, noSource, siteAutohide, hostHidden,
                 startHidden, timerRefreshEnabled>>

EnvironmentChange(i) ==
  AutomaticHide(i) \/ AutomaticShow(i) \/ SourceLost(i) \/ SourceGained(i) \/
  SiteAutohideOn(i) \/ SiteAutohideOff(i) \/ HostHide(i) \/ HostShow(i)

LocalAction(i) ==
  ToggleOne(i) \/ FlashAttempt(i) \/ TimerTick(i) \/ FlashExpire(i) \/
  StopTimerRefresh(i) \/ EnvironmentChange(i) \/ Release(i)

Next ==
  \/ \E i \in Controllers : ToggleOne(i)
  \/ ToggleAll
  \/ \E i \in Controllers : FlashAttempt(i)
  \/ \E i \in Controllers : TimerTick(i)
  \/ \E i \in Controllers : FlashExpire(i)
  \/ \E i \in Controllers : StopTimerRefresh(i)
  \/ \E i \in Controllers : EnvironmentChange(i)
  \/ \E value \in BOOLEAN : SetStartHidden(value)
  \/ \E i \in Controllers : Release(i)

Spec ==
  /\ Init
  /\ [][Next]_vars
  /\ (\A i \in Controllers \ AudioControllers : WF_vars(TimerTick(i)))
  /\ (\A i \in Controllers \ AudioControllers : WF_vars(FlashExpire(i)))

(***************************************************************************)
(* State invariants. Render-precedence checks below are consistency lemmas  *)
(* over the derived Visible predicate; transition safety comes from the     *)
(* media, lifecycle, and non-interference properties. Real CSS is checked   *)
(* by the Chrome matrix rather than represented as a second truth in TLA+.  *)
(***************************************************************************)
FlashMatchesMediaType ==
  \A i \in Controllers :
    IF IsAudio(i)
      THEN flashMode[i] \in {NoFlash, Persistent}
      ELSE flashMode[i] \in {NoFlash, TimedArmed, TimedDue}

HideHasNoFlash ==
  \A i \in Controllers : overrideMode[i] = Hide => flashMode[i] = NoFlash

AudioHasNoTimerRefresh ==
  \A i \in AudioControllers : ~timerRefreshEnabled[i]

DetachedControllerIsInert ==
  \A i \in Controllers :
    ~attached[i] => /\ overrideMode[i] = Auto /\ flashMode[i] = NoFlash /\ ~Visible(i)

VisibleImpliesAttached == \A i \in Controllers : Visible(i) => attached[i]

HardHideDominates ==
  \A i \in Controllers : HardHidden(i) => ~Visible(i)

ForceShowDominatesAutomatic ==
  \A i \in Controllers :
    attached[i] /\ ~hostHidden[i] /\ ~noSource[i] /\ overrideMode[i] = Show
      => Visible(i)

FlashDominatesAutomatic ==
  \A i \in Controllers :
    attached[i] /\ ~hostHidden[i] /\ ~noSource[i] /\
    overrideMode[i] # Hide /\ flashMode[i] # NoFlash
      => Visible(i)

AutoLayerIsExact ==
  \A i \in Controllers :
    attached[i] /\ ~hostHidden[i] /\ ~noSource[i] /\
    overrideMode[i] = Auto /\ flashMode[i] = NoFlash
      => (Visible(i) <=> (~automaticHidden[i] /\ ~siteAutohide[i]))

(***************************************************************************)
(* Action and non-interference properties.                                 *)
(***************************************************************************)
ToggleOneContract ==
  [] [\A i \in Controllers :
        ToggleOne(i) =>
          /\ overrideMode'[i] = ToggleTarget(i)
          /\ flashMode'[i] = NoFlash]_vars

ToggleAllContract ==
  [] [ToggleAll =>
        \A i \in Controllers :
          IF attached[i]
            THEN /\ overrideMode'[i] = ToggleTarget(i)
                 /\ flashMode'[i] = NoFlash
            ELSE /\ overrideMode'[i] = overrideMode[i]
                 /\ flashMode'[i] = flashMode[i]]_vars

StickyToggleIntentContract ==
  [] [\A i \in Controllers :
        attached[i] /\ (ToggleOne(i) \/ ToggleAll)
          => overrideMode'[i] =
               (IF overrideMode[i] = Auto
                  THEN IF Visible(i) THEN Hide ELSE Show
                  ELSE IF overrideMode[i] = Show THEN Hide ELSE Show)]_vars

EnvironmentPreservesIntent ==
  [] [\A i \in Controllers :
        EnvironmentChange(i) =>
          /\ overrideMode' = overrideMode
          /\ flashMode' = flashMode]_vars

StartHiddenSettingIsNonRetroactive ==
  [] [(\E value \in BOOLEAN : SetStartHidden(value)) =>
        /\ overrideMode' = overrideMode
        /\ automaticHidden' = automaticHidden
        /\ flashMode' = flashMode]_vars

LocalActionsAreLocal ==
  [] [\A i \in Controllers :
        LocalAction(i) =>
          \A j \in Controllers :
            j # i =>
              /\ attached'[j] = attached[j]
              /\ overrideMode'[j] = overrideMode[j]
              /\ automaticHidden'[j] = automaticHidden[j]
              /\ noSource'[j] = noSource[j]
              /\ siteAutohide'[j] = siteAutohide[j]
              /\ hostHidden'[j] = hostHidden[j]
              /\ flashMode'[j] = flashMode[j]
              /\ timerRefreshEnabled'[j] = timerRefreshEnabled[j]]_vars

IntentChangesOnlyByToggleOrRelease ==
  [] [(overrideMode' # overrideMode) =>
        (\/ ToggleAll
         \/ \E i \in Controllers : ToggleOne(i) \/ Release(i))]_vars

ManualIntentPersistsUntilRelease ==
  [] [\A i \in Controllers :
        attached[i] /\ overrideMode[i] # Auto /\ attached'[i]
          => overrideMode'[i] # Auto]_vars

TimerRefreshOnlyStops ==
  [] [(timerRefreshEnabled' # timerRefreshEnabled) =>
        (\E i \in Controllers : StopTimerRefresh(i))]_vars

(***************************************************************************)
(* Bounded timer progress. Persistent audio flash intentionally has no      *)
(* expiry property; it lasts until toggle or release. Repeated video flash  *)
(* may legally keep re-arming. StopTimerRefresh is an auxiliary environment *)
(* action that marks a suffix with no more re-arms, making final clearance  *)
(* an explicit, non-vacuous liveness property.                              *)
(***************************************************************************)
ArmedFlashEventuallyAdvances ==
  \A i \in Controllers \ AudioControllers :
    (attached[i] /\ flashMode[i] = TimedArmed)
      ~> (~attached[i] \/ flashMode[i] # TimedArmed)

DueFlashEventuallyHandled ==
  \A i \in Controllers \ AudioControllers :
    (attached[i] /\ flashMode[i] = TimedDue)
      ~> (~attached[i] \/ flashMode[i] # TimedDue)

TimedFlashEventuallyClearsAfterRefreshStops ==
  \A i \in Controllers \ AudioControllers :
    (~timerRefreshEnabled[i] /\ attached[i] /\ flashMode[i] # NoFlash)
      ~> (~attached[i] \/ flashMode[i] = NoFlash)

=============================================================================
