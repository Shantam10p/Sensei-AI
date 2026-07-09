import json
from typing import TypedDict

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph

from app.core.config import get_settings
from app.schemas.sensei import SenseiChatRequest, SenseiContentRequest

try:
    from langchain_tavily import TavilySearch
except ImportError:  # package not installed — search stays disabled
    TavilySearch = None

# Bound on how many times the model may call the search tool in a single
# request, to cap latency and cost.
MAX_TOOL_ITERATIONS = 3


class ContentAgentState(TypedDict):
    request: SenseiContentRequest
    concepts: list[dict]
    practice_questions: list[dict]
    sources: list[dict]


class ChatAgentState(TypedDict):
    request: SenseiChatRequest
    reply: str
    sources: list[dict]


class SenseiAgent:
    def __init__(self) -> None:
        settings = get_settings()
        base_llm = (
            ChatOpenAI(model=settings.PLANNER_AGENT_MODEL, api_key=settings.OPENAI_API_KEY, temperature=0)
            if settings.OPENAI_API_KEY
            else None
        )

        # Build the web-search tool only if both the LLM and a Tavily key exist.
        # Missing either → self.tools stays empty and the agent behaves exactly
        # as before (no search), preserving graceful degradation.
        self.tools: list = []
        self._tools_by_name: dict = {}
        if base_llm is not None and TavilySearch is not None and settings.TAVILY_API_KEY:
            search_tool = TavilySearch(max_results=5, topic="general", api_key=settings.TAVILY_API_KEY)
            self.tools = [search_tool]
            self._tools_by_name = {t.name: t for t in self.tools}

        # Bind the tools so the model can choose to call them; if there are no
        # tools, self.llm is just the plain model.
        self.llm = base_llm.bind_tools(self.tools) if (base_llm is not None and self.tools) else base_llm
        self._raw_llm = base_llm  # unbound handle, used where tools aren't wanted

        # content graph
        content_graph = StateGraph(ContentAgentState)
        content_graph.add_node("generate_content", self._generate_content)
        content_graph.add_edge(START, "generate_content")
        content_graph.add_edge("generate_content", END)
        self.content_graph = content_graph.compile()

        # chat graph
        chat_graph = StateGraph(ChatAgentState)
        chat_graph.add_node("generate_reply", self._generate_reply)
        chat_graph.add_edge(START, "generate_reply")
        chat_graph.add_edge("generate_reply", END)
        self.chat_graph = chat_graph.compile()

    def generate_content(self, request: SenseiContentRequest) -> dict:
        result = self.content_graph.invoke(
            {"request": request, "concepts": [], "practice_questions": [], "sources": []}
        )
        return {
            "concepts": result["concepts"],
            "practice_questions": result["practice_questions"],
            "sources": result.get("sources", []),
        }

    def chat(self, request: SenseiChatRequest) -> dict:
        result = self.chat_graph.invoke({"request": request, "reply": "", "sources": []})
        return {"reply": result["reply"], "sources": result.get("sources", [])}

    def _run_with_tools(self, messages: list) -> tuple:
        """Run a bounded tool-calling loop.

        Invokes the (tool-bound) LLM on the message list. While the model
        responds with tool calls, we execute each requested tool, append the
        results as ToolMessages, and re-invoke — up to MAX_TOOL_ITERATIONS.

        Returns a ``(final_message, sources)`` tuple. ``sources`` is a deduped
        list of ``{"title", "url"}`` dicts gathered from every search result
        the model consulted (empty when no tools ran). If no tools are bound,
        this is a single plain invoke with no sources.
        """
        # No tools bound → behave like a plain single-shot call, no sources.
        if not self.tools:
            return self.llm.invoke(messages), []

        working = list(messages)
        sources: list[dict] = []
        seen_urls: set[str] = set()

        for _ in range(MAX_TOOL_ITERATIONS):
            response = self.llm.invoke(working)
            tool_calls = getattr(response, "tool_calls", None)
            if not tool_calls:
                return response, sources
            # Keep the assistant turn (with its tool_calls) before the results.
            working.append(response)
            for call in tool_calls:
                tool = self._tools_by_name.get(call["name"])
                if tool is None:
                    output = f"Tool '{call['name']}' is not available."
                else:
                    try:
                        output = tool.invoke(call["args"])
                        self._collect_sources(output, sources, seen_urls)
                    except Exception as exc:  # never let a search failure break the reply
                        output = f"Search failed: {exc}"
                working.append(
                    ToolMessage(content=str(output), tool_call_id=call["id"])
                )
        # Cap reached: force one final answer without offering tools again.
        return self._raw_llm.invoke(working), sources

    @staticmethod
    def _collect_sources(tool_output, sources: list[dict], seen_urls: set[str]) -> None:
        """Extract {title, url} from a Tavily tool result into `sources`.

        TavilySearch returns a dict like {"results": [{"title", "url", ...}]}.
        We dedupe by URL and cap the total so the UI stays tidy.
        """
        if not isinstance(tool_output, dict):
            return
        for item in tool_output.get("results", []):
            if not isinstance(item, dict):
                continue
            url = item.get("url")
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)
            sources.append({"title": item.get("title") or url, "url": url})
            if len(sources) >= 8:
                return

    def _generate_content(self, state: ContentAgentState) -> ContentAgentState:
        request = state["request"]

        if self.llm is None:
            return {
                **state,
                "concepts": self._fallback_concepts(request.topic),
                "practice_questions": self._fallback_practice(request.topic),
                "sources": [],
            }

        prompt = f"""You are Sensei AI, a focused study assistant. A student needs exam-ready notes on the following:

Topic: {request.topic}
Course: {request.course_name}

Your job is to produce structured study notes that cover EVERY subtopic a student needs for this topic — ordered from foundational to advanced, so each concept builds naturally on the last. Think of it like a smart friend explaining the topic from scratch in the right order.

You have a web search tool. ALWAYS use it before writing the notes — search for the topic and ground your content in what you find. Prefer well-known, verified educational sources such as W3Schools, GeeksforGeeks, MDN Web Docs, official language/framework documentation, and reputable university or textbook material. Avoid forums, opinion blogs, and unverified sources. Once you have gathered reliable material, produce the final notes.

Return raw valid JSON only. No markdown, no explanation outside the JSON.

{{
  "concepts": [
    {{
      "title": "subtopic name (short, clear)",
      "definition": "2-3 sentence explanation. If this concept builds on a previous one, briefly reference it (e.g. 'Building on tables from above...'). Plain language a student can grasp immediately.",
      "key_points": [
        "exam-specific fact, rule, or gotcha — not generic filler",
        "another point a student must know for exams",
        "common mistake or trick question around this concept",
        "how this differs from a similar concept if relevant",
        "one more essential point"
      ],
      "example": "A concrete, subject-specific example that makes this real. For abstract concepts, use a scenario. For syntax-heavy topics, describe what the code does in plain English.",
      "code_example": "Only include this field if the concept has syntax, commands, queries, or formulas. Write clean Python code that demonstrates the concept. Use \\n for newlines to keep it readable. Omit this field entirely if not applicable."
    }}
  ],
  "practice_questions": [
    {{
      "question": "question text",
      "answer": "direct, clear answer. For conceptual questions explain the reasoning briefly. For tasks show the correct solution with a one-line explanation of why."
    }}
  ]
}}

Rules:
- Cover ALL subtopics within {request.topic} — aim for 8-14 concepts
- Order concepts so foundational ones come first and each logically leads to the next
- Key points must be specific and actionable, never generic filler like "this is important to know"
- Include code_example for any concept involving syntax, queries, commands, formulas, or code — always in Python
- Practice questions must be a mix of: short direct conceptual questions ("What is X?", "What is the difference between X and Y?") AND hands-on tasks ("Write a query to...", "What does this code output?", "Fix this query"). Aim for 8-10 questions total, roughly half conceptual half practical. Keep questions short and direct — no long essay prompts.
- Return only the JSON object, nothing else"""

        try:
            response, sources = self._run_with_tools([HumanMessage(content=prompt)])
            content = response.content if isinstance(response.content, str) else ""
            parsed = json.loads(content)
            concepts = parsed.get("concepts", [])
            practice_questions = parsed.get("practice_questions", [])
            if not isinstance(concepts, list) or not isinstance(practice_questions, list):
                raise ValueError("Invalid structure")
        except (json.JSONDecodeError, ValueError, TypeError):
            concepts = self._fallback_concepts(request.topic)
            practice_questions = self._fallback_practice(request.topic)
            sources = []  # fallback content wasn't grounded in the search results

        return {**state, "concepts": concepts, "practice_questions": practice_questions, "sources": sources}

    def _summarize(self, messages: list) -> str:
        prompt = f"Summarize this tutoring conversation in 3-5 sentences, capturing the key topics and conclusions discussed:\n\n"
        for msg in messages:
            role = "Student" if msg.role == "user" else "Sensei"
            prompt += f"{role}: {msg.content}\n"
        try:
            response = self._raw_llm.invoke(prompt)
            return response.content if isinstance(response.content, str) else ""
        except Exception:
            return ""

    def _generate_reply(self, state: ChatAgentState) -> ChatAgentState:
        request = state["request"]

        if self.llm is None:
            return {**state, "reply": "I'm not available right now. Please try again later.", "sources": []}

        system = SystemMessage(content=f"""You are Sensei AI, an educational assistant helping a student study.
Topic: {request.topic}
Course: {request.course_name}
Keep answers focused, educational, and concise. If asked something off-topic, gently redirect to {request.topic}.
You have a web search tool. ALWAYS use it before answering — search for the student's question and ground your reply in what you find. Prefer well-known, verified educational sources such as W3Schools, GeeksforGeeks, MDN Web Docs, official language/framework documentation, and reputable university or textbook material. Avoid forums, opinion blogs, and unverified sources.""")

        WINDOW = 10
        history = request.history
        messages = [system]

        if len(history) > WINDOW:
            old = history[:-WINDOW]
            window = history[-WINDOW:]
            summary = self._summarize(old)
            if summary:
                messages.append(AIMessage(content=f"[Earlier in this session]: {summary}"))
            for msg in window:
                messages.append(HumanMessage(content=msg.content) if msg.role == "user" else AIMessage(content=msg.content))
        else:
            for msg in history:
                messages.append(HumanMessage(content=msg.content) if msg.role == "user" else AIMessage(content=msg.content))

        messages.append(HumanMessage(content=request.message))

        sources: list[dict] = []
        try:
            response, sources = self._run_with_tools(messages)
            reply = response.content if isinstance(response.content, str) else "I couldn't generate a response."
        except Exception:
            reply = "I'm having trouble connecting right now. Please try again."
            sources = []

        return {**state, "reply": reply, "sources": sources}

    def _fallback_concepts(self, topic: str) -> list[dict]:
        return [
            {
                "title": "Core Definition",
                "definition": f"{topic} refers to the fundamental principles and rules that define this subject area.",
                "key_points": [
                    f"{topic} has a precise meaning in this course context.",
                    "Understanding the definition is the first step before applying it.",
                    "Related terms often build on this core concept.",
                ],
                "example": f"A basic example of {topic} would involve applying its core rules in a straightforward scenario.",
            },
            {
                "title": "Why It Matters",
                "definition": f"Understanding {topic} is essential as it underpins many practical applications in this course.",
                "key_points": [
                    f"{topic} appears frequently in assessments and real-world use.",
                    "Mastery here makes advanced topics easier to grasp.",
                    "Skipping this concept creates gaps that compound later.",
                ],
                "example": f"Without understanding {topic}, common tasks in this subject become difficult to reason about.",
            },
        ]

    def _fallback_practice(self, topic: str) -> list[dict]:
        return [
            {"question": f"What is the core definition of {topic}?", "answer": f"{topic} is defined by its fundamental properties and the problems it addresses."},
            {"question": f"How does {topic} apply in a real-world context?", "answer": f"{topic} appears in various real-world scenarios and is used to solve specific problems in this domain."},
            {"question": f"What is one common misconception about {topic}?", "answer": f"A common mistake is oversimplifying {topic} — it has nuances that only become clear through careful study."},
        ]
