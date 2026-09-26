from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from astrbot.api import logger
from astrbot.api.event import AstrMessageEvent, filter
from astrbot.api.star import Context, Star, register


@register(
    "astrbot_plugin_custom_command_reply",
    "taolicx",
    "在 WebUI 配置自定义指令及对应的文字回复。",
    "1.0.0",
)
class CustomCommandReply(Star):
    def __init__(self, context: Context, config: Any):
        super().__init__(context)
        self.context = context
        self.config = config if isinstance(config, Mapping) else {}

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

    def _wake_prefixes(self, event: AstrMessageEvent) -> list[str]:
        try:
            config = self.context.get_config(umo=event.unified_msg_origin)
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
