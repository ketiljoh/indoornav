import http.server
import ssl

server = http.server.HTTPServer(('0.0.0.0', 8443), http.server.SimpleHTTPRequestHandler)
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain('cert.pem', 'key.pem')
server.socket = ctx.wrap_socket(server.socket, server_side=True)
print('Server kjører på https://0.0.0.0:8443')
print('Åpne https://<din-pc-ip>:8443 på mobilen')
server.serve_forever()
