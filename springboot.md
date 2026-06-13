可以，用 **Spring Boot WebSocket 原生 Handler** 来写，等价于你这段 `ws` 服务端代码。

下面是完整版本。

### 1. pom.xml 加依赖

```
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-websocket</artifactId>
</dependency>
```

------

### 2. WebSocket 配置类

```
package com.example.websocket.config;

import com.example.websocket.handler.ScreenMaxWebSocketHandler;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.*;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final ScreenMaxWebSocketHandler screenMaxWebSocketHandler;

    public WebSocketConfig(ScreenMaxWebSocketHandler screenMaxWebSocketHandler) {
        this.screenMaxWebSocketHandler = screenMaxWebSocketHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(screenMaxWebSocketHandler, "/ws")
                .setAllowedOrigins("*");
    }
}
```

------

### 3. WebSocket Handler

```
package com.example.websocket.handler;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class ScreenMaxWebSocketHandler extends TextWebSocketHandler {

    private final ObjectMapper objectMapper = new ObjectMapper();

    private final Set<WebSocketSession> clients = ConcurrentHashMap.newKeySet();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        clients.add(session);

        session.getAttributes().put("clientId", null);
        session.getAttributes().put("userId", null);
        session.getAttributes().put("pageKey", null);
        session.getAttributes().put("sessionId", null);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        JsonNode msg;

        try {
            msg = objectMapper.readTree(message.getPayload());
        } catch (Exception e) {
            return;
        }

        String type = getText(msg, "type");

        if ("join".equals(type)) {
            session.getAttributes().put("clientId", getText(msg, "clientId"));
            session.getAttributes().put("userId", getText(msg, "userId"));
            session.getAttributes().put("pageKey", getText(msg, "pageKey"));
            return;
        }

        if ("assist-request".equals(type)) {
            String pageKey = (String) session.getAttributes().get("pageKey");

            for (WebSocketSession client : clients) {
                if (
                        client != session &&
                        client.isOpen() &&
                        pageKey != null &&
                        pageKey.equals(client.getAttributes().get("pageKey"))
                ) {
                    send(client, msg);
                }
            }

            return;
        }

        if ("assist-response".equals(type)) {
            String toClientId = getText(msg, "toClientId");
            boolean accepted = msg.has("accepted") && msg.get("accepted").asBoolean();
            String sessionId = getText(msg, "sessionId");

            for (WebSocketSession client : clients) {
                if (
                        client.isOpen() &&
                        toClientId != null &&
                        toClientId.equals(client.getAttributes().get("clientId"))
                ) {
                    send(client, msg);

                    if (accepted) {
                        client.getAttributes().put("sessionId", sessionId);
                        session.getAttributes().put("sessionId", sessionId);
                    }
                }
            }

            return;
        }

        if (
                "mouse-event".equals(type) ||
                "wheel-event".equals(type) ||
                "scroll-event".equals(type)
        ) {
            String sessionId = (String) session.getAttributes().get("sessionId");

            if (sessionId == null) return;

            for (WebSocketSession client : clients) {
                if (
                        client != session &&
                        client.isOpen() &&
                        sessionId.equals(client.getAttributes().get("sessionId"))
                ) {
                    send(client, msg);
                }
            }
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        clients.remove(session);

        System.out.println("client closed: " + session.getAttributes().get("clientId"));
    }

    private void send(WebSocketSession session, JsonNode data) {
        try {
            if (session.isOpen()) {
                session.sendMessage(new TextMessage(data.toString()));
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private String getText(JsonNode node, String field) {
        if (node.has(field) && !node.get(field).isNull()) {
            return node.get(field).asText();
        }
        return null;
    }
}
```

------

### 4. 启动类

```
package com.example.websocket;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class WebSocketApplication {

    public static void main(String[] args) {
        SpringApplication.run(WebSocketApplication.class, args);

        System.out.println("ScreenMax sync server running at ws://localhost:8080/ws");
    }
}
```

前端连接地址从：

```
ws://localhost:8080
```

改成：

```
ws://localhost:8080/ws
```

这个 Spring Boot 版本逻辑和你原来的 Node.js 代码基本一致。