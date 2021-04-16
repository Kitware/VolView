import itk
import json
from helper import RpcApi, rpc


class Api(RpcApi):

    @rpc('run')
    def test(self, arg1, arg2):
        print(type(arg1), type(arg2), arg2)
        with open('spleen_10.json', 'r') as fp:
            mm = json.load(fp)
        return {
            'segmentation': itk.imread('spleen_10-label.nrrd'),
            # 'segmentation': itk.imread('/home/forrestli/data/Branch-label.nrrd'),
            'measurements': mm,
        }
