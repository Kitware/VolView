import itk
from helper import RpcApi, rpc


class Api(RpcApi):

    @rpc('run')
    def test(self, arg1, arg2):
        print(type(arg1), type(arg2), arg2)
        return {
            'segmentation': itk.imread('spleen_10_label.nrrd'),
            # 'segmentation': itk.imread('/home/forrestli/data/Branch-label.nrrd'),
            'measurement': {'meow': 2},
        }
