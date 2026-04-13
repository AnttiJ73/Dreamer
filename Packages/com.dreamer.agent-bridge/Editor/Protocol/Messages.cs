using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Dreamer.AgentBridge
{
    // ───────────────────────────────────────────────
    //  Wire types (JSON-serializable via SimpleJson)
    // ───────────────────────────────────────────────

    [Serializable]
    public class BridgeCommand
    {
        public string id;
        public string kind;
        public string argsJson;
    }

    [Serializable]
    public class CommandResult
    {
        public bool success;
        public string resultJson;
        public string error;

        public static CommandResult Ok(string json)
        {
            return new CommandResult { success = true, resultJson = json, error = null };
        }

        public static CommandResult Fail(string error)
        {
            return new CommandResult { success = false, resultJson = null, error = error };
        }
    }

    [Serializable]
    public class PendingCommandsResponse
    {
        public BridgeCommand[] commands;
    }

    [Serializable]
    public class ResultReport
    {
        public string id;
        public bool success;
        public string resultJson;
        public string error;
    }

    [Serializable]
    public class EditorStateReport
    {
        public bool compiling;
        public string[] compileErrors;
        public bool playMode;
        public ConsoleEntry[] recentConsole;
    }

    [Serializable]
    public class ConsoleEntry
    {
        public string message;
        public string type;
        public string timestamp;
    }

    // ───────────────────────────────────────────────
    //  Lightweight JSON builder / parser
    // ───────────────────────────────────────────────

    public static class SimpleJson
    {
        // ── Serialization (object graph → JSON string) ──

        public static string Serialize(object obj)
        {
            var sb = new StringBuilder(256);
            WriteValue(sb, obj);
            return sb.ToString();
        }

        static void WriteValue(StringBuilder sb, object val)
        {
            if (val == null)
            {
                sb.Append("null");
                return;
            }

            if (val is bool b)
            {
                sb.Append(b ? "true" : "false");
                return;
            }

            if (val is string s)
            {
                WriteString(sb, s);
                return;
            }

            if (val is int i)
            {
                sb.Append(i.ToString(CultureInfo.InvariantCulture));
                return;
            }

            if (val is long l)
            {
                sb.Append(l.ToString(CultureInfo.InvariantCulture));
                return;
            }

            if (val is float f)
            {
                sb.Append(f.ToString("R", CultureInfo.InvariantCulture));
                return;
            }

            if (val is double d)
            {
                sb.Append(d.ToString("R", CultureInfo.InvariantCulture));
                return;
            }

            if (val is Dictionary<string, object> dict)
            {
                sb.Append('{');
                bool first = true;
                foreach (var kv in dict)
                {
                    if (!first) sb.Append(',');
                    first = false;
                    WriteString(sb, kv.Key);
                    sb.Append(':');
                    WriteValue(sb, kv.Value);
                }
                sb.Append('}');
                return;
            }

            if (val is List<object> list)
            {
                sb.Append('[');
                for (int idx = 0; idx < list.Count; idx++)
                {
                    if (idx > 0) sb.Append(',');
                    WriteValue(sb, list[idx]);
                }
                sb.Append(']');
                return;
            }

            if (val is object[] arr)
            {
                sb.Append('[');
                for (int idx = 0; idx < arr.Length; idx++)
                {
                    if (idx > 0) sb.Append(',');
                    WriteValue(sb, arr[idx]);
                }
                sb.Append(']');
                return;
            }

            if (val is string[] sarr)
            {
                sb.Append('[');
                for (int idx = 0; idx < sarr.Length; idx++)
                {
                    if (idx > 0) sb.Append(',');
                    WriteString(sb, sarr[idx]);
                }
                sb.Append(']');
                return;
            }

            // Fallback: treat as string
            WriteString(sb, val.ToString());
        }

        static void WriteString(StringBuilder sb, string s)
        {
            sb.Append('"');
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"':  sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\b': sb.Append("\\b");  break;
                    case '\f': sb.Append("\\f");  break;
                    case '\n': sb.Append("\\n");  break;
                    case '\r': sb.Append("\\r");  break;
                    case '\t': sb.Append("\\t");  break;
                    default:
                        if (c < 0x20)
                            sb.AppendFormat("\\u{0:X4}", (int)c);
                        else
                            sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }

        // ── Convenience builder ──

        public static JsonBuilder Object()
        {
            return new JsonBuilder(isArray: false);
        }

        public static JsonBuilder Array()
        {
            return new JsonBuilder(isArray: true);
        }

        // ── Deserialization (JSON string → object graph) ──

        public static Dictionary<string, object> Deserialize(string json)
        {
            if (string.IsNullOrEmpty(json)) return new Dictionary<string, object>();
            int idx = 0;
            SkipWhitespace(json, ref idx);
            if (idx < json.Length && json[idx] == '{')
            {
                var result = ParseObject(json, ref idx);
                return result;
            }
            return new Dictionary<string, object>();
        }

        public static List<object> DeserializeArray(string json)
        {
            if (string.IsNullOrEmpty(json)) return new List<object>();
            int idx = 0;
            SkipWhitespace(json, ref idx);
            if (idx < json.Length && json[idx] == '[')
            {
                return ParseArray(json, ref idx);
            }
            return new List<object>();
        }

        public static object DeserializeValue(string json)
        {
            if (string.IsNullOrEmpty(json)) return null;
            int idx = 0;
            return ParseValue(json, ref idx);
        }

        // ── Parser internals ──

        static void SkipWhitespace(string json, ref int idx)
        {
            while (idx < json.Length && char.IsWhiteSpace(json[idx])) idx++;
        }

        static object ParseValue(string json, ref int idx)
        {
            SkipWhitespace(json, ref idx);
            if (idx >= json.Length) return null;

            char c = json[idx];
            if (c == '"') return ParseString(json, ref idx);
            if (c == '{') return ParseObject(json, ref idx);
            if (c == '[') return ParseArray(json, ref idx);
            if (c == 't' || c == 'f') return ParseBool(json, ref idx);
            if (c == 'n') return ParseNull(json, ref idx);
            return ParseNumber(json, ref idx);
        }

        static string ParseString(string json, ref int idx)
        {
            idx++; // skip opening quote
            var sb = new StringBuilder();
            while (idx < json.Length)
            {
                char c = json[idx];
                if (c == '"')
                {
                    idx++;
                    return sb.ToString();
                }
                if (c == '\\')
                {
                    idx++;
                    if (idx >= json.Length) break;
                    char esc = json[idx];
                    switch (esc)
                    {
                        case '"':  sb.Append('"');  break;
                        case '\\': sb.Append('\\'); break;
                        case '/':  sb.Append('/');  break;
                        case 'b':  sb.Append('\b'); break;
                        case 'f':  sb.Append('\f'); break;
                        case 'n':  sb.Append('\n'); break;
                        case 'r':  sb.Append('\r'); break;
                        case 't':  sb.Append('\t'); break;
                        case 'u':
                            if (idx + 4 < json.Length)
                            {
                                string hex = json.Substring(idx + 1, 4);
                                if (int.TryParse(hex, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out int codePoint))
                                    sb.Append((char)codePoint);
                                idx += 4;
                            }
                            break;
                        default: sb.Append(esc); break;
                    }
                }
                else
                {
                    sb.Append(c);
                }
                idx++;
            }
            return sb.ToString();
        }

        static Dictionary<string, object> ParseObject(string json, ref int idx)
        {
            var dict = new Dictionary<string, object>();
            idx++; // skip '{'
            SkipWhitespace(json, ref idx);

            if (idx < json.Length && json[idx] == '}')
            {
                idx++;
                return dict;
            }

            while (idx < json.Length)
            {
                SkipWhitespace(json, ref idx);
                if (idx >= json.Length) break;
                if (json[idx] == '}') { idx++; break; }

                // key
                if (json[idx] != '"') break;
                string key = ParseString(json, ref idx);

                SkipWhitespace(json, ref idx);
                if (idx >= json.Length || json[idx] != ':') break;
                idx++; // skip ':'

                // value
                object val = ParseValue(json, ref idx);
                dict[key] = val;

                SkipWhitespace(json, ref idx);
                if (idx < json.Length && json[idx] == ',')
                {
                    idx++;
                    continue;
                }
                if (idx < json.Length && json[idx] == '}')
                {
                    idx++;
                    break;
                }
            }
            return dict;
        }

        static List<object> ParseArray(string json, ref int idx)
        {
            var list = new List<object>();
            idx++; // skip '['
            SkipWhitespace(json, ref idx);

            if (idx < json.Length && json[idx] == ']')
            {
                idx++;
                return list;
            }

            while (idx < json.Length)
            {
                SkipWhitespace(json, ref idx);
                if (idx >= json.Length) break;
                if (json[idx] == ']') { idx++; break; }

                list.Add(ParseValue(json, ref idx));

                SkipWhitespace(json, ref idx);
                if (idx < json.Length && json[idx] == ',')
                {
                    idx++;
                    continue;
                }
                if (idx < json.Length && json[idx] == ']')
                {
                    idx++;
                    break;
                }
            }
            return list;
        }

        static object ParseNumber(string json, ref int idx)
        {
            int start = idx;
            if (idx < json.Length && json[idx] == '-') idx++;
            while (idx < json.Length && char.IsDigit(json[idx])) idx++;

            bool isFloat = false;
            if (idx < json.Length && json[idx] == '.')
            {
                isFloat = true;
                idx++;
                while (idx < json.Length && char.IsDigit(json[idx])) idx++;
            }
            if (idx < json.Length && (json[idx] == 'e' || json[idx] == 'E'))
            {
                isFloat = true;
                idx++;
                if (idx < json.Length && (json[idx] == '+' || json[idx] == '-')) idx++;
                while (idx < json.Length && char.IsDigit(json[idx])) idx++;
            }

            string numStr = json.Substring(start, idx - start);
            if (isFloat)
            {
                if (double.TryParse(numStr, NumberStyles.Float, CultureInfo.InvariantCulture, out double d))
                    return d;
            }
            else
            {
                if (long.TryParse(numStr, NumberStyles.Integer, CultureInfo.InvariantCulture, out long l))
                {
                    if (l >= int.MinValue && l <= int.MaxValue)
                        return (int)l;
                    return l;
                }
            }
            return 0;
        }

        static bool ParseBool(string json, ref int idx)
        {
            if (json.Length - idx >= 4 && json.Substring(idx, 4) == "true")
            {
                idx += 4;
                return true;
            }
            if (json.Length - idx >= 5 && json.Substring(idx, 5) == "false")
            {
                idx += 5;
                return false;
            }
            idx++;
            return false;
        }

        static object ParseNull(string json, ref int idx)
        {
            if (json.Length - idx >= 4 && json.Substring(idx, 4) == "null")
            {
                idx += 4;
                return null;
            }
            idx++;
            return null;
        }

        // ── Helper: safe value extraction from dictionaries ──

        public static string GetString(Dictionary<string, object> dict, string key, string fallback = null)
        {
            if (dict != null && dict.TryGetValue(key, out object val) && val is string s)
                return s;
            return fallback;
        }

        public static int GetInt(Dictionary<string, object> dict, string key, int fallback = 0)
        {
            if (dict == null || !dict.TryGetValue(key, out object val)) return fallback;
            if (val is int i) return i;
            if (val is long l) return (int)l;
            if (val is double d) return (int)d;
            if (val is string s && int.TryParse(s, out int parsed)) return parsed;
            return fallback;
        }

        public static float GetFloat(Dictionary<string, object> dict, string key, float fallback = 0f)
        {
            if (dict == null || !dict.TryGetValue(key, out object val)) return fallback;
            if (val is double d) return (float)d;
            if (val is int i) return i;
            if (val is long l) return l;
            if (val is float f) return f;
            if (val is string s && float.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out float parsed)) return parsed;
            return fallback;
        }

        public static bool GetBool(Dictionary<string, object> dict, string key, bool fallback = false)
        {
            if (dict == null || !dict.TryGetValue(key, out object val)) return fallback;
            if (val is bool b) return b;
            if (val is string s) return s.Equals("true", StringComparison.OrdinalIgnoreCase);
            return fallback;
        }

        public static object GetValue(Dictionary<string, object> dict, string key)
        {
            if (dict != null && dict.TryGetValue(key, out object val)) return val;
            return null;
        }
    }

    // ── Fluent JSON builder ──

    public class JsonBuilder
    {
        readonly StringBuilder _sb = new StringBuilder(256);
        readonly bool _isArray;
        bool _hasItems;

        internal JsonBuilder(bool isArray)
        {
            _isArray = isArray;
            _sb.Append(isArray ? '[' : '{');
        }

        void Sep()
        {
            if (_hasItems) _sb.Append(',');
            _hasItems = true;
        }

        public JsonBuilder Put(string key, string val)
        {
            Sep();
            AppendString(_sb, key);
            _sb.Append(':');
            if (val == null) _sb.Append("null");
            else AppendString(_sb, val);
            return this;
        }

        public JsonBuilder Put(string key, bool val)
        {
            Sep();
            AppendString(_sb, key);
            _sb.Append(':');
            _sb.Append(val ? "true" : "false");
            return this;
        }

        public JsonBuilder Put(string key, int val)
        {
            Sep();
            AppendString(_sb, key);
            _sb.Append(':');
            _sb.Append(val.ToString(CultureInfo.InvariantCulture));
            return this;
        }

        public JsonBuilder Put(string key, long val)
        {
            Sep();
            AppendString(_sb, key);
            _sb.Append(':');
            _sb.Append(val.ToString(CultureInfo.InvariantCulture));
            return this;
        }

        public JsonBuilder Put(string key, float val)
        {
            Sep();
            AppendString(_sb, key);
            _sb.Append(':');
            _sb.Append(val.ToString("R", CultureInfo.InvariantCulture));
            return this;
        }

        public JsonBuilder Put(string key, double val)
        {
            Sep();
            AppendString(_sb, key);
            _sb.Append(':');
            _sb.Append(val.ToString("R", CultureInfo.InvariantCulture));
            return this;
        }

        public JsonBuilder PutNull(string key)
        {
            Sep();
            AppendString(_sb, key);
            _sb.Append(":null");
            return this;
        }

        /// <summary>Put a raw JSON value (already serialized).</summary>
        public JsonBuilder PutRaw(string key, string rawJson)
        {
            Sep();
            AppendString(_sb, key);
            _sb.Append(':');
            _sb.Append(rawJson ?? "null");
            return this;
        }

        /// <summary>Put a string array.</summary>
        public JsonBuilder Put(string key, string[] arr)
        {
            Sep();
            AppendString(_sb, key);
            _sb.Append(":[");
            if (arr != null)
            {
                for (int i = 0; i < arr.Length; i++)
                {
                    if (i > 0) _sb.Append(',');
                    if (arr[i] == null) _sb.Append("null");
                    else AppendString(_sb, arr[i]);
                }
            }
            _sb.Append(']');
            return this;
        }

        // ── Array element methods ──

        public JsonBuilder Add(string val)
        {
            Sep();
            if (val == null) _sb.Append("null");
            else AppendString(_sb, val);
            return this;
        }

        public JsonBuilder AddRaw(string rawJson)
        {
            Sep();
            _sb.Append(rawJson ?? "null");
            return this;
        }

        public override string ToString()
        {
            return _sb.ToString() + (_isArray ? "]" : "}");
        }

        static void AppendString(StringBuilder sb, string s)
        {
            sb.Append('"');
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"':  sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n");  break;
                    case '\r': sb.Append("\\r");  break;
                    case '\t': sb.Append("\\t");  break;
                    default:
                        if (c < 0x20)
                            sb.AppendFormat("\\u{0:X4}", (int)c);
                        else
                            sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }
    }
}
