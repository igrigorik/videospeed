---------------------------- MODULE SpeedArbiter ----------------------------
(***************************************************************************)
(* Formal model of VSC's shared-authority, per-media arbitration contract. *)
(*                                                                         *)
(* The cfg bounds this model to two controlled media elements. desired,     *)
(* stored, and rememberEnabled are document/session-wide; each media has its *)
(* own rate register, phase, fight budget, re-arm budget, temporary native *)
(* override, and pending observation.                                      *)
(*                                                                         *)
(* authorityEpoch is represented by an eager abstraction: a VSC/native     *)
(* authority claim resets every local conflict record to HOLDING. The real  *)
(* adapter does this lazily with epoch-tagged WeakMap records, but clearing *)
(* stale records eagerly is observationally equivalent and finite. It also  *)
(* makes the key guarantee explicit: a local surrender on A cannot survive *)
(* a new shared authority claim on B. A temporary native override is an     *)
(* orthogonal local overlay and deliberately survives B's authority claim. *)
(*                                                                         *)
(* Classifier verdicts are untrusted inputs. The model explores            *)
(* USER_INTENT, AUTONOMOUS, and INIT_NOISE. A recognized temporary native  *)
(* override is modeled as its own start/end pair; gesture ownership, pointer *)
(* lifecycle, and echo queues remain adapter refinements tested in JS.      *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS
  Speeds,      \* e.g. {"one", "fast"}; must contain "one"
  Videos,      \* e.g. {"A", "B"}
  MaxFight     \* local fight budget per window (implementation default: 4)

None == "NONE"
ModeValues == {"NoOpinion", "Holding", "Rearmable", "Suppressed"}
RateClasses == {"UserIntent", "Autonomous", "InitNoise"}

ASSUME /\ "one" \in Speeds
       /\ "fast" \in Speeds
       /\ None \notin Speeds
       /\ Cardinality(Videos) >= 2
       /\ MaxFight \in Nat /\ MaxFight > 0

VARIABLES
  rate,                 \* [Videos -> Speeds], each video.playbackRate
  desired,              \* shared in-memory session authority, or None
  stored,               \* persisted lastSpeed, or None
  rememberEnabled,      \* whether user authority claims write persistent storage
  attached,             \* [Videos -> BOOLEAN], controller lifetime
  mode,                 \* [Videos -> ModeValues], local conflict phase
  fightCount,           \* [Videos -> 0..MaxFight]
  pending,              \* [Videos -> BOOLEAN], unprocessed ratechange
  pendingClass,         \* [Videos -> RateClasses], untrusted classifier input
  pendingQuiet,         \* [Videos -> BOOLEAN], quietness of the observation
  warQuiet,             \* [Videos -> BOOLEAN], every fight in this local war quiet
  rearmBudget,          \* [Videos -> 0..1], local quiet-war re-arms remaining
  temporary,            \* [Videos -> BOOLEAN], local native hold overlay
  authorityClaim        \* ghost: this transition began a fresh shared epoch

vars ==
  <<rate, desired, stored, rememberEnabled, attached, mode, fightCount, pending,
    pendingClass, pendingQuiet, warQuiet, rearmBudget, temporary, authorityClaim>>

Replace(f, i, value) == [j \in Videos |-> IF j = i THEN value ELSE f[j]]

CanRearm(i) == warQuiet[i] /\ pendingQuiet[i] /\ rearmBudget[i] > 0

TypeOK ==
  /\ rate \in [Videos -> Speeds]
  /\ desired \in Speeds \cup {None}
  /\ stored \in Speeds \cup {None}
  /\ rememberEnabled \in BOOLEAN
  /\ attached \in [Videos -> BOOLEAN]
  /\ mode \in [Videos -> ModeValues]
  /\ fightCount \in [Videos -> 0..MaxFight]
  /\ pending \in [Videos -> BOOLEAN]
  /\ pendingClass \in [Videos -> RateClasses]
  /\ pendingQuiet \in [Videos -> BOOLEAN]
  /\ warQuiet \in [Videos -> BOOLEAN]
  /\ rearmBudget \in [Videos -> 0..1]
  /\ temporary \in [Videos -> BOOLEAN]
  /\ authorityClaim \in BOOLEAN

(***************************************************************************)
(* LOAD: no session authority, or one shared remembered/site-rule value.   *)
(* stored is intentionally independent: a site rule may seed desired while  *)
(* remembered storage retains a different speed.                            *)
(***************************************************************************)
Init ==
  /\ desired \in Speeds \cup {None}
  /\ stored \in Speeds \cup {None}
  /\ rememberEnabled \in BOOLEAN
  /\ rate \in [Videos -> Speeds]
  /\ IF desired # None THEN \A i \in Videos : rate[i] = desired ELSE TRUE
  /\ attached = [i \in Videos |-> TRUE]
  /\ mode = [i \in Videos |-> IF desired = None THEN "NoOpinion" ELSE "Holding"]
  /\ fightCount = [i \in Videos |-> 0]
  /\ pending = [i \in Videos |-> FALSE]
  /\ pendingClass = [i \in Videos |-> "Autonomous"]
  /\ pendingQuiet = [i \in Videos |-> FALSE]
  /\ warQuiet = [i \in Videos |-> TRUE]
  /\ rearmBudget = [i \in Videos |-> 1]
  /\ temporary = [i \in Videos |-> FALSE]
  /\ authorityClaim = FALSE

(* A VSC action starts one fresh shared authority generation. In production
   batch actions call this epoch transition once, then apply local USER_SET
   to their remaining targets; that adapter batching is covered by JS tests. *)
UserSet(i, v) ==
  /\ attached[i]
  /\ rate' = Replace(rate, i, v)
  /\ desired' = v
  /\ stored' = IF rememberEnabled THEN v ELSE stored
  /\ mode' = [j \in Videos |-> IF attached[j] THEN "Holding" ELSE "NoOpinion"]
  /\ fightCount' = [j \in Videos |-> 0]
  /\ warQuiet' = [j \in Videos |-> TRUE]
  /\ rearmBudget' = [j \in Videos |-> 1]
  /\ temporary' = Replace(temporary, i, FALSE)
  /\ authorityClaim' = TRUE
  /\ UNCHANGED <<rememberEnabled, attached, pending, pendingClass, pendingQuiet>>

(* The page writes one media register. At most one observation per media is
   represented; browser coalescing means a newer write replaces it before
   the listener observes it, so this bounded model simply waits to observe. *)
SiteWrite(i, v, c, q) ==
  /\ attached[i]
  /\ ~pending[i]
  /\ rate' = Replace(rate, i, v)
  /\ pending' = Replace(pending, i, TRUE)
  /\ pendingClass' = Replace(pendingClass, i, c)
  /\ pendingQuiet' = Replace(pendingQuiet, i, q)
  /\ authorityClaim' = FALSE
  /\ UNCHANGED <<desired, stored, rememberEnabled, attached, mode, fightCount,
               warQuiet, rearmBudget, temporary>>

(* A native user choice claims the same shared authority as a VSC choice. *)
ObserveUserIntent(i) ==
  /\ attached[i]
  /\ pending[i]
  /\ pendingClass[i] = "UserIntent"
  /\ desired' = rate[i]
  /\ stored' = IF rememberEnabled THEN rate[i] ELSE stored
  /\ mode' = [j \in Videos |-> IF attached[j] THEN "Holding" ELSE "NoOpinion"]
  /\ fightCount' = [j \in Videos |-> 0]
  /\ pending' = Replace(pending, i, FALSE)
  /\ pendingClass' = Replace(pendingClass, i, "Autonomous")
  /\ pendingQuiet' = Replace(pendingQuiet, i, FALSE)
  /\ warQuiet' = [j \in Videos |-> TRUE]
  /\ rearmBudget' = [j \in Videos |-> 1]
  /\ temporary' = Replace(temporary, i, FALSE)
  /\ authorityClaim' = TRUE
  /\ UNCHANGED <<rate, rememberEnabled, attached>>

(* AUTONOMOUS divergence within i's local budget: re-assert shared desired
   only on i. No other media's counter, phase, or register changes. *)
ObserveAutonomousFight(i) ==
  /\ attached[i]
  /\ pending[i]
  /\ pendingClass[i] = "Autonomous"
  /\ desired # None
  /\ mode[i] = "Holding"
  /\ rate[i] # desired
  /\ fightCount[i] < MaxFight
  /\ rate' = Replace(rate, i, desired)
  /\ mode' = mode
  /\ fightCount' = Replace(fightCount, i, fightCount[i] + 1)
  /\ pending' = Replace(pending, i, FALSE)
  /\ pendingClass' = Replace(pendingClass, i, "Autonomous")
  /\ pendingQuiet' = Replace(pendingQuiet, i, FALSE)
  /\ warQuiet' = Replace(
       warQuiet,
       i,
       IF fightCount[i] = 0 THEN pendingQuiet[i] ELSE warQuiet[i] /\ pendingQuiet[i]
     )
  /\ rearmBudget' = rearmBudget
  /\ authorityClaim' = FALSE
  /\ UNCHANGED <<desired, stored, rememberEnabled, attached, temporary>>

(* Local surrender. desired deliberately remains untouched: A's hostile
   player cannot clear document authority or suppress B. *)
ObserveAutonomousSurrender(i) ==
  /\ attached[i]
  /\ pending[i]
  /\ pendingClass[i] = "Autonomous"
  /\ desired # None
  /\ mode[i] = "Holding"
  /\ rate[i] # desired
  /\ fightCount[i] = MaxFight
  /\ mode' = Replace(mode, i, IF CanRearm(i) THEN "Rearmable" ELSE "Suppressed")
  /\ fightCount' = Replace(fightCount, i, 0)
  /\ pending' = Replace(pending, i, FALSE)
  /\ pendingClass' = Replace(pendingClass, i, "Autonomous")
  /\ pendingQuiet' = Replace(pendingQuiet, i, FALSE)
  /\ warQuiet' = Replace(warQuiet, i, TRUE)
  /\ rearmBudget' = Replace(
       rearmBudget,
       i,
       IF CanRearm(i) THEN rearmBudget[i] - 1 ELSE rearmBudget[i]
     )
  /\ authorityClaim' = FALSE
  /\ UNCHANGED <<rate, desired, stored, rememberEnabled, attached, temporary>>

(* A recognized site-specific hold is a local overlay, not USER_INTENT: it
   may display a different rate while held but never claims desired/stored. *)
TemporaryOverrideStart(i) ==
  /\ attached[i]
  /\ desired # None
  /\ ~temporary[i]
  /\ rate' = Replace(rate, i, "fast")
  /\ temporary' = Replace(temporary, i, TRUE)
  /\ authorityClaim' = FALSE
  /\ UNCHANGED <<desired, stored, rememberEnabled, attached, mode, fightCount,
               pending, pendingClass, pendingQuiet, warQuiet, rearmBudget>>

(* The native release returns control to the underlying local phase. HOLDING
   restores the current shared desired speed; a suppressed/rearmable/no-opinion
   record remains locally non-enforcing. *)
TemporaryOverrideEnd(i) ==
  /\ attached[i]
  /\ temporary[i]
  /\ rate' = Replace(
       rate,
       i,
       IF desired # None /\ mode[i] = "Holding" THEN desired ELSE "one"
     )
  /\ temporary' = Replace(temporary, i, FALSE)
  /\ authorityClaim' = FALSE
  /\ UNCHANGED <<desired, stored, rememberEnabled, attached, mode, fightCount,
               pending, pendingClass, pendingQuiet, warQuiet, rearmBudget>>

(* INIT_NOISE is intentionally ignored. It may leave a temporary divergence
   for lifecycle to heal, so this finite safety model does not assert global
   convergence after an init-noise verdict. *)
ObserveInitNoise(i) ==
  /\ attached[i]
  /\ pending[i]
  /\ pendingClass[i] = "InitNoise"
  /\ pending' = Replace(pending, i, FALSE)
  /\ pendingClass' = Replace(pendingClass, i, "Autonomous")
  /\ pendingQuiet' = Replace(pendingQuiet, i, FALSE)
  /\ authorityClaim' = FALSE
  /\ UNCHANGED <<rate, desired, stored, rememberEnabled, attached, mode,
               fightCount, warQuiet, rearmBudget, temporary>>

(* Autonomous confirmation, no authority, and already-local-suppressed or
   rearmable media are observation-only. *)
ObserveNoop(i) ==
  /\ attached[i]
  /\ pending[i]
  /\ pendingClass[i] = "Autonomous"
  /\ (desired = None \/ mode[i] # "Holding" \/ rate[i] = desired)
  /\ pending' = Replace(pending, i, FALSE)
  /\ pendingClass' = Replace(pendingClass, i, "Autonomous")
  /\ pendingQuiet' = Replace(pendingQuiet, i, FALSE)
  /\ authorityClaim' = FALSE
  /\ UNCHANGED <<rate, desired, stored, rememberEnabled, attached, mode,
               fightCount, warQuiet, rearmBudget, temporary>>

(* Any autonomous observation leaves shared authority untouched and can only
   advance one media's local record. This named action is checked below as a
   two-media non-interference property. *)
AutonomousObservation(i) ==
  \/ ObserveAutonomousFight(i)
  \/ ObserveAutonomousSurrender(i)
  \/ ObserveNoop(i)

(* Lifecycle is local. A temporary native override owns its media register
   until release; otherwise HOLDING reasserts i, REARMABLE reasserts it once,
   while SUPPRESSED and NO_OPINION stay silent. *)
Lifecycle(i) ==
  /\ attached[i]
  /\ IF temporary[i]
       THEN /\ UNCHANGED <<rate, mode, fightCount, warQuiet, rearmBudget>>
       ELSE IF desired # None /\ mode[i] = "Holding"
            THEN /\ rate' = Replace(rate, i, desired)
                 /\ mode' = mode
                 /\ fightCount' = fightCount
                 /\ warQuiet' = warQuiet
                 /\ rearmBudget' = rearmBudget
            ELSE IF desired # None /\ mode[i] = "Rearmable"
                 THEN /\ rate' = Replace(rate, i, desired)
                      /\ mode' = Replace(mode, i, "Holding")
                      /\ fightCount' = fightCount
                      /\ warQuiet' = warQuiet
                      /\ rearmBudget' = rearmBudget
                 ELSE /\ UNCHANGED <<rate, mode, fightCount, warQuiet, rearmBudget>>
  /\ temporary' = temporary
  /\ authorityClaim' = FALSE
  /\ UNCHANGED <<desired, stored, rememberEnabled, attached, pending,
               pendingClass, pendingQuiet>>

FightWindowExpire(i) ==
  /\ attached[i]
  /\ fightCount[i] > 0
  /\ fightCount' = Replace(fightCount, i, 0)
  /\ warQuiet' = Replace(warQuiet, i, TRUE)
  /\ authorityClaim' = FALSE
  /\ UNCHANGED <<rate, desired, stored, rememberEnabled, attached, mode,
               pending, pendingClass, pendingQuiet, rearmBudget, temporary>>

(* Controller teardown releases all local state/timers. Shared desired and
   every other media record survive. Reattachment is out of scope here: a
   fresh controller is equivalent to a fresh bounded run. *)
Release(i) ==
  /\ attached[i]
  /\ attached' = Replace(attached, i, FALSE)
  /\ mode' = Replace(mode, i, "NoOpinion")
  /\ fightCount' = Replace(fightCount, i, 0)
  /\ pending' = Replace(pending, i, FALSE)
  /\ pendingClass' = Replace(pendingClass, i, "Autonomous")
  /\ pendingQuiet' = Replace(pendingQuiet, i, FALSE)
  /\ warQuiet' = Replace(warQuiet, i, TRUE)
  /\ rearmBudget' = Replace(rearmBudget, i, 1)
  /\ temporary' = Replace(temporary, i, FALSE)
  /\ authorityClaim' = FALSE
  /\ UNCHANGED <<rate, desired, stored, rememberEnabled>>

Next ==
  \/ \E i \in Videos, v \in Speeds : UserSet(i, v)
  \/ \E i \in Videos, v \in Speeds, c \in RateClasses, q \in BOOLEAN :
       SiteWrite(i, v, c, q)
  \/ \E i \in Videos : ObserveUserIntent(i)
  \/ \E i \in Videos : TemporaryOverrideStart(i)
  \/ \E i \in Videos : TemporaryOverrideEnd(i)
  \/ \E i \in Videos : ObserveAutonomousFight(i)
  \/ \E i \in Videos : ObserveAutonomousSurrender(i)
  \/ \E i \in Videos : ObserveInitNoise(i)
  \/ \E i \in Videos : ObserveNoop(i)
  \/ \E i \in Videos : Lifecycle(i)
  \/ \E i \in Videos : FightWindowExpire(i)
  \/ \E i \in Videos : Release(i)
  \/ UNCHANGED vars

Spec == Init /\ [][Next]_vars

(***************************************************************************)
(* Invariants and action properties.                                      *)
(***************************************************************************)

SharedAuthorityCoupling ==
  /\ desired = None => \A i \in Videos : attached[i] => mode[i] = "NoOpinion"
  /\ desired # None => \A i \in Videos : attached[i] => mode[i] # "NoOpinion"

(* A current local REARMABLE or SUPPRESSED phase is never allowed to erase
   the shared authority needed by another media element. *)
LocalSurrenderRetainsAuthority ==
  \A i \in Videos :
    attached[i] /\ mode[i] \in {"Rearmable", "Suppressed"} => desired # None

ReleasedMediaInert ==
  \A i \in Videos :
    ~attached[i] => /\ ~pending[i] /\ fightCount[i] = 0 /\ ~temporary[i]

(* A new user/native authority epoch resets every per-media conflict budget.
   This is the eager equivalent of invalidating epoch-tagged records. The
   temporary overlay is intentionally excluded: B claiming authority must not
   erase A's active native hold before A receives its release event. *)
AuthorityClaimResetsLocalConflicts ==
  [] [(authorityClaim' =>
        /\ desired' # None
        /\ \A i \in Videos :
             attached'[i] =>
               /\ mode'[i] = "Holding" /\ fightCount'[i] = 0 /\ warQuiet'[i]
               /\ rearmBudget'[i] = 1)]_vars

RearmBudgetResetOnlyOnAuthorityClaim ==
  [] [\A i \in Videos :
        attached[i] /\ attached'[i] /\ rearmBudget'[i] > rearmBudget[i]
          => authorityClaim']_vars

PersistencePurity ==
  [] [((stored' # stored) => authorityClaim')]_vars

(* Autonomous arbitration for A must not mutate B's register, conflict
   record, pending observation, or shared authority/persistence state. *)
AutonomousArbitrationIsLocal ==
  [] [\A i \in Videos :
        AutonomousObservation(i) =>
          /\ desired' = desired
          /\ stored' = stored
          /\ \A j \in Videos :
               j # i =>
                 /\ rate'[j] = rate[j]
                 /\ mode'[j] = mode[j]
                 /\ fightCount'[j] = fightCount[j]
                 /\ pending'[j] = pending[j]
                 /\ pendingClass'[j] = pendingClass[j]
                 /\ pendingQuiet'[j] = pendingQuiet[j]
                 /\ warQuiet'[j] = warQuiet[j]
                 /\ rearmBudget'[j] = rearmBudget[j]
                 /\ temporary'[j] = temporary[j]]_vars

(* A temporary native override on A may touch only A's register/overlay. It
   cannot claim shared authority, persist speed, or change B's local record. *)
TemporaryOverrideIsLocal ==
  [] [\A i \in Videos :
        (TemporaryOverrideStart(i) \/ TemporaryOverrideEnd(i)) =>
          /\ desired' = desired
          /\ stored' = stored
          /\ ~authorityClaim'
          /\ \A j \in Videos :
               j # i =>
                 /\ rate'[j] = rate[j]
                 /\ mode'[j] = mode[j]
                 /\ fightCount'[j] = fightCount[j]
                 /\ pending'[j] = pending[j]
                 /\ pendingClass'[j] = pendingClass[j]
                 /\ pendingQuiet'[j] = pendingQuiet[j]
                 /\ warQuiet'[j] = warQuiet[j]
                 /\ rearmBudget'[j] = rearmBudget[j]
                 /\ temporary'[j] = temporary[j]]_vars

(* A lifecycle event for i cannot write another media register. *)
LifecycleIsLocal ==
  [] [\A i \in Videos : Lifecycle(i) =>
        \A j \in Videos : j # i => rate'[j] = rate[j]]_vars

(* A suppressed local record stays silent on its own lifecycle events. *)
SuppressedLifecycleIsSilent ==
  [] [\A i \in Videos :
        attached[i] /\ mode[i] = "Suppressed" /\ Lifecycle(i) => rate'[i] = rate[i]]_vars

TemporaryLifecycleIsSilent ==
  [] [\A i \in Videos :
        attached[i] /\ temporary[i] /\ Lifecycle(i) => rate'[i] = rate[i]]_vars

=============================================================================
