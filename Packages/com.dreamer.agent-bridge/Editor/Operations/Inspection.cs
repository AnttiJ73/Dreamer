using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace Dreamer.AgentBridge
{
    public class InspectionOptions
    {
        // -1 = unlimited; 0 = root only. childCount always reported.
        public int Depth = -1;
        public bool IncludeTransforms;
        public bool IncludeFields;
    }

    /// <summary>Shared GameObject → JSON serialiser used by inspect_asset, inspect_hierarchy, inspect_assets so all produce identical node shape.</summary>
    public static class Inspection
    {
        public static string BuildGameObjectInfo(GameObject go, InspectionOptions opts)
        {
            return BuildNode(go, 0, opts ?? new InspectionOptions());
        }

        static string BuildNode(GameObject go, int currentDepth, InspectionOptions opts)
        {
            var obj = SimpleJson.Object()
                .Put("name", go.name)
                .Put("instanceId", go.GetInstanceID())
                .Put("active", go.activeSelf)
                .Put("tag", go.tag)
                .Put("layer", go.layer)
                .Put("isStatic", go.isStatic);

            if (opts.IncludeTransforms)
            {
                var t = go.transform;
                obj.PutRaw("transform", SimpleJson.Object()
                    .PutRaw("localPosition", FormatVec3(t.localPosition))
                    .PutRaw("localEulerAngles", FormatVec3(t.localEulerAngles))
                    .PutRaw("localScale", FormatVec3(t.localScale))
                    .ToString());
            }

            var comps = SimpleJson.Array();
            foreach (var comp in go.GetComponents<Component>())
            {
                if (comp == null) continue;
                var ct = comp.GetType();
                var compObj = SimpleJson.Object()
                    .Put("type", ct.Name)
                    .Put("fullType", ct.FullName)
                    .Put("enabled", IsEnabled(comp));
                if (opts.IncludeFields)
                    compObj.PutRaw("fields", BuildFieldsArray(comp));
                comps.AddRaw(compObj.ToString());
            }
            obj.PutRaw("components", comps.ToString());

            int childCount = go.transform.childCount;
            obj.Put("childCount", childCount);

            bool recurse = (opts.Depth < 0) || (currentDepth < opts.Depth);
            if (recurse && childCount > 0)
            {
                var children = SimpleJson.Array();
                for (int i = 0; i < childCount; i++)
                {
                    var child = go.transform.GetChild(i).gameObject;
                    children.AddRaw(BuildNode(child, currentDepth + 1, opts));
                }
                obj.PutRaw("children", children.ToString());
            }

            return obj.ToString();
        }

        static bool IsEnabled(Component comp)
        {
            if (comp is Behaviour b) return b.enabled;
            if (comp is Renderer r) return r.enabled;
            if (comp is Collider c) return c.enabled;
            return true;
        }

        static string BuildFieldsArray(Component comp)
        {
            var fields = SimpleJson.Array();
            try
            {
                var so = new SerializedObject(comp);
                var prop = so.GetIterator();
                if (prop.NextVisible(true))
                {
                    do
                    {
                        if (prop.name == "m_Script" || prop.name == "m_ObjectHideFlags") continue;
                        var fieldObj = SimpleJson.Object()
                            .Put("name", prop.name)
                            .Put("type", prop.propertyType.ToString());
                        AppendFieldValue(fieldObj, prop);
                        fields.AddRaw(fieldObj.ToString());
                    } while (prop.NextVisible(false));
                }
            }
            catch { /* best-effort */ }
            return fields.ToString();
        }

        /// <summary>Serialize a SerializedProperty to a raw JSON value (embed via PutRaw).</summary>
        public static string SerializeValue(SerializedProperty prop)
        {
            if (prop == null) return "null";
            switch (prop.propertyType)
            {
                case SerializedPropertyType.Integer: return prop.intValue.ToString(System.Globalization.CultureInfo.InvariantCulture);
                case SerializedPropertyType.Float: return prop.floatValue.ToString("R", System.Globalization.CultureInfo.InvariantCulture);
                case SerializedPropertyType.Boolean: return prop.boolValue ? "true" : "false";
                case SerializedPropertyType.String: return JsonString(prop.stringValue);
                case SerializedPropertyType.Enum:
                    if (prop.enumValueIndex >= 0 && prop.enumValueIndex < prop.enumNames.Length)
                        return JsonString(prop.enumNames[prop.enumValueIndex]);
                    return prop.intValue.ToString(System.Globalization.CultureInfo.InvariantCulture);
                case SerializedPropertyType.Vector2: return FormatVec2(prop.vector2Value);
                case SerializedPropertyType.Vector3: return FormatVec3(prop.vector3Value);
                case SerializedPropertyType.Vector4: return FormatVec4(prop.vector4Value);
                case SerializedPropertyType.Quaternion:
                    {
                        var q = prop.quaternionValue;
                        return FormatVec4(new Vector4(q.x, q.y, q.z, q.w));
                    }
                case SerializedPropertyType.Color:
                    {
                        var c = prop.colorValue;
                        return SimpleJson.Object().Put("r", c.r).Put("g", c.g).Put("b", c.b).Put("a", c.a).ToString();
                    }
                case SerializedPropertyType.ObjectReference:
                    {
                        var o = prop.objectReferenceValue;
                        if (o == null) return "null";
                        return SimpleJson.Object()
                            .Put("name", o.name)
                            .Put("type", o.GetType().Name)
                            .Put("assetPath", AssetDatabase.GetAssetPath(o) ?? "")
                            .Put("instanceId", o.GetInstanceID())
                            .ToString();
                    }
                case SerializedPropertyType.ArraySize: return prop.intValue.ToString(System.Globalization.CultureInfo.InvariantCulture);
                case SerializedPropertyType.LayerMask: return prop.intValue.ToString(System.Globalization.CultureInfo.InvariantCulture);
                default: return "null";
            }
        }

        static string JsonString(string s)
        {
            if (s == null) return "null";
            var sb = new System.Text.StringBuilder(s.Length + 2);
            sb.Append('"');
            foreach (var ch in s)
            {
                switch (ch)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (ch < 0x20) sb.AppendFormat(System.Globalization.CultureInfo.InvariantCulture, "\\u{0:x4}", (int)ch);
                        else sb.Append(ch);
                        break;
                }
            }
            sb.Append('"');
            return sb.ToString();
        }

        static void AppendFieldValue(JsonBuilder fieldObj, SerializedProperty prop)
        {
            fieldObj.PutRaw("value", SerializeValue(prop));
        }

        static string FormatVec2(Vector2 v) => SimpleJson.Object().Put("x", v.x).Put("y", v.y).ToString();
        static string FormatVec3(Vector3 v) => SimpleJson.Object().Put("x", v.x).Put("y", v.y).Put("z", v.z).ToString();
        static string FormatVec4(Vector4 v) => SimpleJson.Object().Put("x", v.x).Put("y", v.y).Put("z", v.z).Put("w", v.w).ToString();
    }
}
