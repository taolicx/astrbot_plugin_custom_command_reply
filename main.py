from __future__ import annotations

import asyncio
import hashlib
import json
from collections.abc import Mapping
from typing import Any

from astrbot.api import logger
from astrbot.api.event import AstrMessageEvent, filter
from astrbot.api.star import Context, Star, register
from astrbot.api.web import error_response, json_response, request


PLUGIN_NAME = "astrbot_plugin_custom_command_reply"
MAX_RULES = 200
MAX_COMMAND_LENGTH = 80
MAX_REPLY_LENGTH = 10000


@register(
    PLUGIN_NAME,
    "taolicx",
    "在独立管理页配置自定义指令及对应的文字回复。",
    "1.1.0",
)
class CustomCommandReply(Star):
    def __init__(self, context: Context, config: Any):
        super().__init__(context)
        self.context = context
        self.config = config if isinstance(config, Mapping) else {}
        self._rules_lock = asyncio.Lock()
        context.register_web_api(
            f"/{PLUGIN_NAME}/rules",
            self.get_rules,
            ["GET"],
            "读取自定义指令规则",
        )
        context.register_web_api(
            f"/{PLUGIN_NAME}/rules",
            self.save_rules,
            ["POST"],
            "保存自定义指令规则",
        )

    async def get_rules(self):
        async with self._rules_lock:
            rules = self.config.get("rules", [])
            prefixes = self._wake_prefixes()
            return json_response(
                {
                    "rules": self._public_rules(rules),
                    "revision": self._revision(rules),
                    "prefix": prefixes[0] if prefixes else "",
                }
            )

    async def save_rules(self):
        payload = await request.json(default={})
        if not isinstance(payload, dict):
            return error_response("请求内容必须是对象。", status_code=400)
        revision = payload.get("revision")
        if not isinstance(revision, str):
            return error_response("缺少配置版本，请刷新页面后再试。", status_code=400)

        try:
            rules = self._validate_rules(payload.get("rules"))
        except ValueError as exc:
            return error_response(str(exc), status_code=400)

        async with self._rules_lock:
            old_rules = self.config.get("rules", [])
            if revision != self._revision(old_rules):
                return error_response(
                    "规则已在其他页面修改，请刷新后重试。", status_code=409
                )
            self.config["rules"] = rules
            try:
                self.config.save_config()
            except Exception as exc:
                self.config["rules"] = old_rules
                logger.error(f"[CustomCommandReply] 保存规则失败：{exc}")
                return error_response("保存失败，请查看 AstrBot 日志。", status_code=500)
            prefixes = self._wake_prefixes()
            return json_response(
                {
                    "rules": self._public_rules(rules),
                    "revision": self._revision(rules),
                    "prefix": prefixes[0] if prefixes else "",
                }
            )

    @staticmethod
    def _public_rules(rules: Any) -> list[dict[str, Any]]:
        if not isinstance(rules, list):
            return []
        result = []
        for rule in rules:
            if not isinstance(rule, Mapping):
                continue
            result.append(
                {
                    "command": rule.get("command", ""),
                    "reply": rule.get("reply", ""),
                    "enabled": rule.get("enabled", True),
                }
            )
        return result

    @staticmethod
    def _revision(rules: Any) -> str:
        raw = json.dumps(rules, ensure_ascii=False, sort_keys=True, default=str)
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def _validate_rules(self, raw_rules: Any) -> list[dict[str, Any]]:
        if not isinstance(raw_rules, list):
            raise ValueError("规则必须是列表。")
        if len(raw_rules) > MAX_RULES:
            raise ValueError(f"最多只能添加 {MAX_RULES} 条规则。")

        rules = []
        names = set()
        prefixes = self._wake_prefixes()
        for index, raw in enumerate(raw_rules, start=1):
            if not isinstance(raw, dict):
                raise ValueError(f"第 {index} 条规则格式不正确。")
            command = raw.get("command")
            reply = raw.get("reply")
            enabled = raw.get("enabled", True)
            if not isinstance(command, str) or not command.strip():
                raise ValueError(f"第 {index} 条规则缺少指令名称。")
            command = command.strip()
            if len(command) > MAX_COMMAND_LENGTH or any(ord(c) < 32 for c in command):
                raise ValueError(f"第 {index} 条指令名称过长或包含换行。")
            if command.startswith("/") or any(
                command.startswith(prefix) for prefix in prefixes
            ):
                raise ValueError(f"第 {index} 条指令名称不要填写指令前缀。")
            if command in names:
                raise ValueError(f"指令“{command}”重复，请保留一条。")
            if not isinstance(reply, str) or not reply.strip():
                raise ValueError(f"第 {index} 条规则缺少回复文字。")
            if len(reply) > MAX_REPLY_LENGTH:
                raise ValueError(f"第 {index} 条回复文字超过 {MAX_REPLY_LENGTH} 字。")
            if not isinstance(enabled, bool):
                raise ValueError(f"第 {index} 条规则的启用状态不正确。")
            names.add(command)
            rules.append(
                {
                    "__template_key": "reply_rule",
                    "command": command,
                    "reply": reply,
                    "enabled": enabled,
                }
            )
        return rules

    @filter.event_message_type(
        filter.EventMessageType.GROUP_MESSAGE | filter.EventMessageType.PRIVATE_MESSAGE,
        priority=1000,
    )
    async def on_message(self, event: AstrMessageEvent):
        if not self.config.get("enabled", True):
            return

        # AstrBot 会从 event.message_str 中移除唤醒前缀；原始消息仍在 message_obj 中。
        raw_text = getattr(getattr(event, "message_obj", None), "message_str", None)
        if not isinstance(raw_text, str):
            return
        raw_text = raw_text.strip()

        command = self._extract_command(raw_text, self._wake_prefixes(event))
        if command is None:
            return

        rules = self.config.get("rules", [])
        if not isinstance(rules, list):
            logger.warning("[CustomCommandReply] rules 不是列表，已忽略。")
            return

        for rule in rules:
            if not isinstance(rule, Mapping) or not rule.get("enabled", True):
                continue
            name = rule.get("command")
            reply = rule.get("reply")
            if not isinstance(name, str) or not isinstance(reply, str):
                continue
            name = name.strip()
            if not name or not reply.strip():
                continue
            if command == name:
                yield event.plain_result(reply).stop_event()
                return

    def _wake_prefixes(self, event: AstrMessageEvent | None = None) -> list[str]:
        try:
            config = (
                self.context.get_config(umo=event.unified_msg_origin)
                if event is not None
                else self.context.get_config()
            )
            raw_prefixes = config.get("wake_prefix", ["/"])
        except Exception as exc:
            logger.warning(f"[CustomCommandReply] 读取 AstrBot 指令前缀失败，使用 /：{exc}")
            raw_prefixes = ["/"]

        if isinstance(raw_prefixes, str):
            raw_prefixes = [raw_prefixes]
        if not isinstance(raw_prefixes, (list, tuple)):
            raw_prefixes = ["/"]
        prefixes = [p for p in raw_prefixes if isinstance(p, str) and p]
        return sorted(set(prefixes), key=len, reverse=True)

    @staticmethod
    def _extract_command(raw_text: str, prefixes: list[str]) -> str | None:
        for prefix in prefixes:
            if raw_text.startswith(prefix):
                command = raw_text[len(prefix) :].strip()
                return command or None
        return None
