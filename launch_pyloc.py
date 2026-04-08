#! /usr/bin/env python

__author__ = 'iped'
import os
import sys
import traceback

os.environ['QT_API'] = 'pyqt5'
os.environ['ETS_TOOLKIT'] = 'qt4'

def _exception_hook(exctype, value, tb):
    traceback.print_exception(exctype, value, tb)
    sys.__excepthook__(exctype, value, tb)

sys.excepthook = _exception_hook

from view.pyloc import PylocControl
import yaml

if __name__ == '__main__':
    config = yaml.safe_load(open(os.path.join(os.path.dirname(__file__), 'config.yml')))
    controller = PylocControl(config)
    controller.exec_()
