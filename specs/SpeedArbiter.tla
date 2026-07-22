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
(*     by the write-token registry (each WRITE registers the value it      *)
(*     expects to echo; the adapter consumes matching tokens); VSC's own   *)
(*     writes therefore create no pending observation here. v2 could      *)
(*     model the token queue explicitly alongside the init window.        *)
(*   - KNOWN v1 GAP (found by the JS mini-checker): table cell 11 lets an  *)
(*     INIT_NOISE-classified write leave the register diverged from a held *)
(*     authority until the next lifecycle event heals it. This model       *)
(*     scopes init churn out entirely (see the LOAD postcondition), so     *)
(*     HoldingDivergenceImpliesPending / QuiescentConvergence hold only in *)
(*     the post-init world. v2 must add an InitNoise observation and       *)
(*     restate convergence as conditional on a subsequent Lifecycle.       *)
(*                                                                         *)
(* Historical note: Buggy* single-defect variants reproduced the           *)
(* pre-migration bugs (#1537, F1) during the strangler-fig rewrite; they   *)
(* were removed with the legacy-compat machinery. See git tag              *)
(* arbitration-executable-history.                                         *)
(***************************************************************************)
EXTENDS Naturals

CONSTANTS
  Speeds,   \* e.g. {"one", "v", "w"}; must contain "one"
  MaxFight  \* fight-back budget per window (impl: 4 effective)

None == "NONE"

ASSUME /\ "one" \in Speeds
       /\ None \notin Speeds
       /\ MaxFight \in Nat /\ MaxFight > 0

VARIABLES
  rate,         \* the shared register: video.playbackRate
  mode,         \* "NoOpinion" | "Holding" | "Rearmable" (cells 9/9b/14)
  desired,      \* authoritative target; None iff NoOpinion (impl: lastSpeed;
                \* in Rearmable it is the pre-war speed pending restoration)
  stored,       \* persisted lastSpeed (chrome.storage), for purity checking
  fightCount,   \* consecutive autonomous resets fought this window
  pending,      \* BOOLEAN: an external ratechange awaits arbitration
  pendingQuiet, \* BOOLEAN: the pending change arrived in INPUT-quiet context
                \* (no user input for QUIET_CONTEXT_MS — cannot be a
                \* misclassified user action). NOT the same as `quiet` below.
  warQuiet,     \* BOOLEAN: every fight of the current war was input-quiet
  rearmBudget,  \* 0..1: quiet-war re-arms remaining this session
  quiet,        \* BOOLEAN: site has permanently stopped writing (monotone)
  lastWriter    \* ghost: who last changed rate ("init"|"user"|"site"|"vsc")

vars ==
  <<rate, mode, desired, stored, fightCount, pending, pendingQuiet, warQuiet,
    rearmBudget, quiet, lastWriter>>

TypeOK ==
  /\ rate \in Speeds
  /\ mode \in {"NoOpinion", "Holding", "Rearmable"}
  /\ desired \in Speeds \cup {None}
  /\ stored \in Speeds \cup {None}
  /\ fightCount \in 0..MaxFight
  /\ pending \in BOOLEAN
  /\ pendingQuiet \in BOOLEAN
  /\ warQuiet \in BOOLEAN
  /\ rearmBudget \in 0..1
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
  /\ pendingQuiet = FALSE
  /\ warQuiet = TRUE
  /\ rearmBudget = 1
  /\ quiet = FALSE
  /\ lastWriter = "init"

(* Rules 5, 12, 16: the user acts through VSC. The only unambiguous input.
   Clears any pending observation: our write supersedes it and its native
   echo is absorbed by the write-token filter. *)
UserSet(v) ==
  /\ rate' = v
  /\ mode' = "Holding"
  /\ desired' = v
  /\ stored' = v
  /\ fightCount' = 0
  /\ pending' = FALSE
  /\ pendingQuiet' = FALSE
  /\ warQuiet' = TRUE
  /\ lastWriter' = "user"
  /\ UNCHANGED <<rearmBudget, quiet>>

(* The adversary: the site writes the register whenever it likes. *)
SiteWrite(v) ==
  /\ ~quiet
  /\ rate' = v
  /\ pending' = TRUE
  /\ pendingQuiet' \in BOOLEAN  \* input context is the environment's choice
  /\ lastWriter' = "site"
  /\ UNCHANGED <<mode, desired, stored, fightCount, warQuiet, rearmBudget, quiet>>

(* Rules 2, 7: classifier verdict USER_INTENT — adopt the current rate as
   the new authority, persist it. Works from any mode: the user spoke. *)
ObserveUserIntent ==
  /\ pending
  /\ pending' = FALSE
  /\ pendingQuiet' = FALSE
  /\ mode' = "Holding"
  /\ desired' = rate
  /\ stored' = rate
  /\ fightCount' = 0
  /\ warQuiet' = TRUE
  /\ UNCHANGED <<rate, rearmBudget, quiet, lastWriter>>

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
  /\ pendingQuiet' = FALSE
  /\ warQuiet' = IF fightCount = 0 THEN pendingQuiet ELSE warQuiet /\ pendingQuiet
  /\ lastWriter' = "vsc"
  /\ UNCHANGED <<mode, desired, stored, rearmBudget, quiet>>

(* Rules 9/9b: budget exhausted — stand down. If the ENTIRE war was
   input-quiet (no reset could have been a misclassified user action,
   because all intent evidence is input) and a re-arm remains, stand down
   REARMABLE: the next lifecycle event restores the pre-war speed once
   (rule 14). Otherwise surrender is terminal for the session — an
   activity-context war might have been fought against a misclassified
   user, and attrition safety (the user wins after the budget) must hold.
   Storage is untouched in both variants. *)
ObserveAutonomousSurrender ==
  /\ pending
  /\ mode = "Holding"
  /\ rate # desired
  /\ fightCount = MaxFight
  /\ fightCount' = 0
  /\ pending' = FALSE
  /\ pendingQuiet' = FALSE
  /\ warQuiet' = TRUE
  /\ IF warQuiet /\ pendingQuiet /\ rearmBudget > 0
       THEN /\ mode' = "Rearmable"
            /\ desired' = desired      \* the pre-war speed, pending re-arm
            /\ rearmBudget' = rearmBudget - 1
       ELSE /\ mode' = "NoOpinion"
            /\ desired' = None
            /\ UNCHANGED rearmBudget
  /\ UNCHANGED <<rate, stored, quiet, lastWriter>>

(* Rules 3, 4, 10, 11, 15: everything else — the site confirmed our value,
   or we have no opinion / already surrendered (observe only), or the
   classifier says INIT_NOISE (ignore). Consume the observation; at most
   the UI indicator moves. *)
ObserveNoop ==
  /\ pending
  /\ (mode # "Holding" \/ rate = desired)
  /\ pending' = FALSE
  /\ pendingQuiet' = FALSE
  /\ UNCHANGED <<rate, mode, desired, stored, fightCount, warQuiet, rearmBudget,
                 quiet, lastWriter>>

(* Rules 1, 6, 14: play / seeked / deferred loadedmetadata.
   Holding: re-assert desired, never persist (#1494; F1 flag models the
   current step-6 leak). NoOpinion: nothing (the flag models pre-#1537
   forcing of the 1.0 baseline). Post-surrender states are NoOpinion. *)
Lifecycle ==
  \/ /\ mode = "Holding"
     /\ rate' = desired
     /\ stored' = stored
     /\ lastWriter' = IF rate # desired THEN "vsc" ELSE lastWriter
     /\ UNCHANGED <<mode, desired, fightCount, pending, pendingQuiet, warQuiet,
                    rearmBudget, quiet>>
  \/ /\ mode = "Rearmable"
     \* Rule 14: the quiet-war re-arm — restore the pre-war speed once.
     \* In-memory authority only; stored is untouched (purity preserved).
     /\ mode' = "Holding"
     /\ rate' = desired
     /\ lastWriter' = IF rate # desired THEN "vsc" ELSE lastWriter
     /\ UNCHANGED <<desired, stored, fightCount, pending, pendingQuiet, warQuiet,
                    rearmBudget, quiet>>

(* Rule 13: FIGHT_WINDOW_MS elapsed without new fights — forgive. *)
FightWindowExpire ==
  /\ fightCount > 0
  /\ fightCount' = 0
  /\ warQuiet' = TRUE
  /\ UNCHANGED <<rate, mode, desired, stored, pending, pendingQuiet, rearmBudget,
                 quiet, lastWriter>>

(* The site permanently stops writing. Only needed so convergence
   properties have something to converge under. *)
SiteGoQuiet ==
  /\ ~quiet
  /\ quiet' = TRUE
  /\ UNCHANGED <<rate, mode, desired, stored, fightCount, pending, pendingQuiet,
                 warQuiet, rearmBudget, lastWriter>>

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

(* I5: authority (or a pending re-arm value) exists exactly outside
   NoOpinion. *)
ModeDesiredCoupling ==
  (desired # None) <=> (mode \in {"Holding", "Rearmable"})

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

(* I1: in NoOpinion, VSC never writes the register (historically violated
   by the pre-#1537 lifecycle baseline write). *)
NoOpinionNeverWrites ==
  [][ (mode = "NoOpinion" /\ mode' = "NoOpinion" /\ rate' # rate)
        => lastWriter' # "vsc" ]_vars

(* Re-arms are bounded: the budget never increases within a session. *)
RearmBudgetMonotone ==
  [][rearmBudget' <= rearmBudget]_vars

(* I2: persisted state moves only on a user action or a user-intent
   adoption (both consume: UserSet sets lastWriter'="user"; adoption
   consumes pending). This is invariant I2, historically violated by F1.
   Note rule 14 (re-arm) restores in-memory authority WITHOUT touching
   stored — this property is exactly why that distinction matters. *)
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
