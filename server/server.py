import sys
import os
import webbrowser
import socket
import argparse
import importlib

from wslink.websocket import ServerProtocol
from wslink import server
from twisted.internet import reactor


def get_port():
    # Don't care about race condition here for getting a free port
    # if someone binds the port between get_port() and actually binding,
    # then the server won't start
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(('localhost', 0))
    _, port = sock.getsockname()
    sock.close()
    return port


def create_protocol(ApiClass):
    class ApiProtocol(ServerProtocol):
        authKey = 'wslink-secret'

        @staticmethod
        def configure(options):
            ApiProtocol.authKey = options.authKey

        def initialize(self):
            self.registerLinkProtocol(ApiClass())
            self.updateSecret(ApiProtocol.authKey)

    return ApiProtocol


if __name__ == '__main__':
    # https://stackoverflow.com/questions/7674790/bundling-data-files-with-pyinstaller-onefile
    try:
        basepath = sys._MEIPASS
    except:
        basepath = os.path.dirname(os.path.dirname(sys.argv[0]))

    parser = argparse.ArgumentParser()
    parser.add_argument('-H', '--host', default='localhost',
                        help='Hostname for server to listen on')
    parser.add_argument('-P', '--port', default=get_port(),
                        help='Port for server to listen on')
    parser.add_argument('-b', '--no-browser', action='store_true',
                        help='Do not auto-open the browser')
    parser.add_argument('api_script',
                        help='Python file that exposes ServerApi')
    args = parser.parse_args()

    static_dir = os.path.join(basepath, 'www')
    host = args.host
    port = args.port
    server_args = [
        '--content', static_dir,
        '--host', host,
        '--port', str(port)
    ]

    wsurl = 'ws://{host}:{port}/ws'.format(host=host, port=port)
    full_url = 'http://{host}:{port}/?wsServer={wsurl}'.format(
        host=host, port=port, wsurl=wsurl)

    def open_webapp():
        webbrowser.open(full_url)

    # if not args.no_browser:
    #    print('If the browser doesn\'t open, navigate to:', full_url)
    #    reactor.callLater(0.1, open_webapp)

    sys.path.append(os.path.dirname(os.path.realpath(__file__)))

    spec = importlib.util.spec_from_file_location('Api', args.api_script)
    api_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(api_module)

    server.start(server_args, create_protocol(api_module.Api))
    server.stop_webserver()
