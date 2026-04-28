using System;
using System.Collections.Generic;

namespace Dreamer.AgentBridge.Animation
{
    /// <summary>Registration entry point for the Animation add-on — core's CommandDispatcher reflection-loads any Dreamer.AgentBridge.*.Registration.Register.</summary>
    public static class Registration
    {
        public static void Register(Dictionary<string, Func<Dictionary<string, object>, CommandResult>> handlers)
        {
            if (handlers == null) return;

            handlers["create_animation_clip"]    = AnimationClipOps.CreateAnimationClip;
            handlers["set_animation_curve"]      = AnimationClipOps.SetAnimationCurve;
            handlers["inspect_animation_clip"]   = AnimationClipOps.InspectAnimationClip;
            handlers["sample_animation_curve"]   = AnimationClipOps.SampleAnimationCurve;
            handlers["delete_animation_curve"]   = AnimationClipOps.DeleteAnimationCurve;
            handlers["set_sprite_curve"]         = AnimationClipOps.SetSpriteCurve;
            handlers["delete_sprite_curve"]      = AnimationClipOps.DeleteSpriteCurve;
            handlers["set_animation_events"]     = AnimationClipOps.SetAnimationEvents;

            handlers["create_animator_controller"] = AnimatorOps.CreateAnimatorController;
            handlers["add_animator_parameter"]     = AnimatorOps.AddAnimatorParameter;
            handlers["add_animator_state"]         = AnimatorOps.AddAnimatorState;
            handlers["add_animator_transition"]    = AnimatorOps.AddAnimatorTransition;
            handlers["set_animator_default_state"] = AnimatorOps.SetAnimatorDefaultState;
            handlers["inspect_animator_controller"]= AnimatorOps.InspectAnimatorController;

            handlers["remove_animator_parameter"]  = AnimatorOps.RemoveAnimatorParameter;
            handlers["remove_animator_state"]      = AnimatorOps.RemoveAnimatorState;
            handlers["remove_animator_transition"] = AnimatorOps.RemoveAnimatorTransition;
            handlers["update_animator_state"]      = AnimatorOps.UpdateAnimatorState;
            handlers["update_animator_transition"] = AnimatorOps.UpdateAnimatorTransition;

            handlers["add_animator_layer"]         = AnimatorOps.AddAnimatorLayer;
            handlers["remove_animator_layer"]      = AnimatorOps.RemoveAnimatorLayer;
            handlers["set_animator_layer"]         = AnimatorOps.SetAnimatorLayer;

            handlers["add_animator_blend_tree"]    = AnimatorOps.AddAnimatorBlendTree;

            handlers["create_avatar_mask"]         = AvatarMaskOps.CreateAvatarMask;
            handlers["set_avatar_mask"]            = AvatarMaskOps.SetAvatarMask;
            handlers["inspect_avatar_mask"]        = AvatarMaskOps.InspectAvatarMask;

            handlers["create_animator_override_controller"] = AnimatorOverrideOps.CreateAnimatorOverrideController;
            handlers["set_animator_override_clip"]          = AnimatorOverrideOps.SetAnimatorOverrideClip;
            handlers["inspect_animator_override_controller"]= AnimatorOverrideOps.InspectAnimatorOverrideController;
        }
    }
}
