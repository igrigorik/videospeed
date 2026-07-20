---------------------------- MODULE SpeedArbiter ----------------------------
(***************************************************************************)
(* Formal model of VSC's speed arbitration contract.                       *)
(*                                                                         *)
(* This is the machine-checked twin of docs/speed-arbitration.md. The      *)
(* human-readable transition table and this module describe the same       *)
(* object; rule numbers in comments refer to the table.                    *)
(*                                                                         *)
(* Modeling decisions:                                                     *)
(*   - Speeds are abstracted to a small symbolic set. "one" is the 1.0     *)
(*     baseline; other members stand for arbitrary distinct user speeds.   *)
(*   - Real time is abstracted away: timers appear as nondeterministic     *)
(*     expiry events, gesture windows as the classifier's verdict.         *)
(*   - The classifier is an untrusted oracle: every external ratechange    *)
(*     is classified nondeterministically (USER_INTENT / AUTONOMOUS /      *)
(*     INIT_NOISE), so TLC explores every possible classification,        *)
(*     including wrong ones. Properties must hold regardless.              *)
(*   - The site is an adversary: it may write the register at any moment   *)
(*     until it "goes quiet" (needed only for convergence properties).     *)
(*   - At most one unprocessed observation is pending; a newer site write  *)
(*     coalesces with it (the arbiter reads the current rate at observe    *)
(*     time, as the implementation does).                                  *)
(*   - Self-originated ratechange echoes are filtered before the arbiter   *)
(*     (cooldown + detail.origin); VSC's own writes create no pending      *)
(*     observation here.                                                   *)
(*                                                                         *)
(* The Buggy* constants enable single-defect variants reproducing known    *)
(* deviations of current master from the contract:                         *)
(*   BuggyNoOpinionLifecycle: cell 1 writes the 1.0 baseline (issue #1537) *)
(*   BuggyLifecyclePersist:   cell 6 persists on lifecycle restore (F1)    *)
(***************************************************************************)
EXTENDS Naturals

CONSTANTS
  Speeds,                   \* e.g. {"one", "v", "w"}; must contain "one"
  MaxFight,                 \* fight-back budget per window (impl: 5)
  BuggyNoOpinionLifecycle,  \* BOOLEAN: model pre-#1537 behavior
  BuggyLifecyclePersist     \* BOOLEAN: model finding F1

None == "NONE"

ASSUME /\ "one" \in Speeds
       /\ None \notin Speeds
       /\ MaxFight \in Nat /\ MaxFight > 0
       /\ BuggyNoOpinionLifecycle \in BOOLEAN
       /\ BuggyLifecyclePersist \in BOOLEAN

VARIABLES
  rate,        \* the shared register: video.playbackRate
  mode,        \* "NoOpinion" | "Holding" | "Surrendered"
  desired,     \* authoritative target; None iff not Holding (impl: lastSpeed)
  stored,      \* persisted lastSpeed (chrome.storage), for purity checking
  fightCount,  \* consecutive autonomous resets fought this window
  pending,     \* BOOLEAN: an external ratechange awaits arbitration
  quiet,       \* BOOLEAN: site has permanently stopped writing (monotone)
  lastWriter   \* ghost: who last changed rate ("init"|"user"|"site"|"vsc")

vars == <<rate, mode, desired, stored, fightCount, pending, quiet, lastWriter>>

TypeOK ==
  /\ rate \in Speeds
  /\ mode \in {"NoOpinion", "Holding", "Surrendered"}
  /\ desired \in Speeds \cup {None}
  /\ stored \in Speeds \cup {None}
  /\ fightCount \in 0..MaxFight
  /\ pending \in BOOLEAN
  /\ quiet \in BOOLEAN
  /\ lastWriter \in {"init", "user", "site", "vsc"}

(***************************************************************************)
(* LOAD: initial states cover every configuration —                       *)
(*   NoOpinion:  rememberSpeed off (or nothing stored), no site rule       *)
(*   Holding(d): remembered speed, or a per-site rule as initial authority *)
(*               (the F5 unification; stored may differ from desired,      *)
(*               which is exactly the site-rule + rememberSpeed case)      *)
(*                                                                         *)
(* LOAD postcondition (found by TLC, v1 scoping decision): in Holding the  *)
(* register already reflects desired — i.e. initializeSpeed() and its      *)
(* deferred loadedmetadata application are part of LOAD, an adapter        *)
(* obligation that completes before arbitration begins. The load-to-       *)
(* first-write race window (player init fights, readyState<1) is out of    *)
(* scope for this spec version and must be revisited when modeling the     *)
(* adapter layer.                                                          *)
(***************************************************************************)
Init ==
  /\ \/ (mode = "NoOpinion" /\ desired = None /\ rate \in Speeds)
     \/ (mode = "Holding" /\ desired \in Speeds /\ rate = desired)
  /\ stored \in Speeds \cup {None}
  /\ fightCount = 0
  /\ pending = FALSE
  /\ quiet = FALSE
  /\ lastWriter = "init"

(* Rules 5, 12, 16: the user acts through VSC. The only unambiguous input.
   Clears any pending observation: our write supersedes it and the
   synchronous echo is cooldown-filtered. *)
UserSet(v) ==
  /\ rate' = v
  /\ mode' = "Holding"
  /\ desired' = v
  /\ stored' = v
  /\ fightCount' = 0
  /\ pending' = FALSE
  /\ lastWriter' = "user"
  /\ UNCHANGED quiet

(* The adversary: the site writes the register whenever it likes. *)
SiteWrite(v) ==
  /\ ~quiet
  /\ rate' = v
  /\ pending' = TRUE
  /\ lastWriter' = "site"
  /\ UNCHANGED <<mode, desired, stored, fightCount, quiet>>

(* Rules 2, 7: classifier verdict USER_INTENT — adopt the current rate as
   the new authority, persist it. Works from any mode: the user spoke. *)
ObserveUserIntent ==
  /\ pending
  /\ pending' = FALSE
  /\ mode' = "Holding"
  /\ desired' = rate
  /\ stored' = rate
  /\ fightCount' = 0
  /\ UNCHANGED <<rate, quiet, lastWriter>>

(* Rule 8: classifier verdict AUTONOMOUS while we hold a diverging
   authority and have fight budget — enforce ours. *)
ObserveAutonomousFight ==
  /\ pending
  /\ mode = "Holding"
  /\ rate # desired
  /\ fightCount < MaxFight
  /\ rate' = desired
  /\ fightCount' = fightCount + 1
  /\ pending' = FALSE
  /\ lastWriter' = "vsc"
  /\ UNCHANGED <<mode, desired, stored, quiet>>

(* Rule 9: budget exhausted — surrender AND stand down. Authority is
   dropped (desired := None), so the war cannot silently restart (F2). *)
ObserveAutonomousSurrender ==
  /\ pending
  /\ mode = "Holding"
  /\ rate # desired
  /\ fightCount = MaxFight
  /\ mode' = "Surrendered"
  /\ desired' = None
  /\ fightCount' = 0
  /\ pending' = FALSE
  /\ UNCHANGED <<rate, stored, quiet, lastWriter>>

(* Rules 3, 4, 10, 11, 15: everything else — the site confirmed our value,
   or we have no opinion / already surrendered (observe only), or the
   classifier says INIT_NOISE (ignore). Consume the observation; at most
   the UI indicator moves. *)
ObserveNoop ==
  /\ pending
  /\ (mode # "Holding" \/ rate = desired)
  /\ pending' = FALSE
  /\ UNCHANGED <<rate, mode, desired, stored, fightCount, quiet, lastWriter>>

(* Rules 1, 6, 14: play / seeked / deferred loadedmetadata.
   Holding: re-assert desired, never persist (#1494; F1 flag models the
   current step-6 leak). NoOpinion: nothing (the flag models pre-#1537
   forcing of the 1.0 baseline). Surrendered: nothing. *)
Lifecycle ==
  \/ /\ mode = "Holding"
     /\ rate' = desired
     /\ stored' = IF BuggyLifecyclePersist THEN desired ELSE stored
     /\ lastWriter' = IF rate # desired THEN "vsc" ELSE lastWriter
     /\ UNCHANGED <<mode, desired, fightCount, pending, quiet>>
  \/ /\ mode = "NoOpinion"
     /\ BuggyNoOpinionLifecycle
     /\ rate' = "one"
     /\ lastWriter' = IF rate # "one" THEN "vsc" ELSE lastWriter
     /\ UNCHANGED <<mode, desired, stored, fightCount, pending, quiet>>

(* Rule 13: FIGHT_WINDOW_MS elapsed without new fights — forgive. *)
FightWindowExpire ==
  /\ fightCount > 0
  /\ fightCount' = 0
  /\ UNCHANGED <<rate, mode, desired, stored, pending, quiet, lastWriter>>

(* The site permanently stops writing. Only needed so convergence
   properties have something to converge under. *)
SiteGoQuiet ==
  /\ ~quiet
  /\ quiet' = TRUE
  /\ UNCHANGED <<rate, mode, desired, stored, fightCount, pending, lastWriter>>

Next ==
  \/ \E v \in Speeds : UserSet(v)
  \/ \E v \in Speeds : SiteWrite(v)
  \/ ObserveUserIntent
  \/ ObserveAutonomousFight
  \/ ObserveAutonomousSurrender
  \/ ObserveNoop
  \/ Lifecycle
  \/ FightWindowExpire
  \/ SiteGoQuiet

(* Weak fairness on arbitration: pending observations are eventually
   processed (the ratechange handler always runs). *)
Spec == Init /\ [][Next]_vars
             /\ WF_vars(ObserveUserIntent \/ ObserveAutonomousFight
                        \/ ObserveAutonomousSurrender \/ ObserveNoop)

-----------------------------------------------------------------------------
(* INVARIANTS (I-numbers from docs/speed-arbitration.md) *)

(* I5: authority exists exactly in Holding mode. *)
ModeDesiredCoupling ==
  (desired # None) <=> (mode = "Holding")

(* Supporting lemma for I4: in Holding, divergence implies an unprocessed
   observation — the arbiter never knowingly leaves the register wrong. *)
HoldingDivergenceImpliesPending ==
  (mode = "Holding" /\ rate # desired) => pending

(* I4: once the site is quiet and observations are drained, a held
   authority is reflected in the register. *)
QuiescentConvergence ==
  (quiet /\ ~pending /\ mode = "Holding") => rate = desired

-----------------------------------------------------------------------------
(* ACTION PROPERTIES *)

(* I1: in NoOpinion, VSC never writes the register. Violated by the
   BuggyNoOpinionLifecycle variant (issue #1537). *)
NoOpinionNeverWrites ==
  [][ (mode = "NoOpinion" /\ mode' = "NoOpinion" /\ rate' # rate)
        => lastWriter' # "vsc" ]_vars

(* I2: persisted state moves only on a user action or a user-intent
   adoption (both consume: UserSet sets lastWriter'="user"; adoption
   consumes pending). Violated by the BuggyLifecyclePersist variant (F1). *)
PersistencePurity ==
  [][ (stored' # stored)
        => (lastWriter' = "user" \/ (pending /\ ~pending')) ]_vars

-----------------------------------------------------------------------------
(* LIVENESS *)

(* Observations are drained: any pending observation is eventually
   arbitrated (from WF), hence with a quiet site the system reaches and
   stays in a drained state. *)
ObservationsDrain == [](pending => <>(~pending))

=============================================================================
