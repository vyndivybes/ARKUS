import tempfile
import unittest
import zipfile
from pathlib import Path
from backup import export_backup, restore_backup
from skill_forge import SkillForge
from parametric_cad import ParametricCAD

class RegistryBackupTests(unittest.TestCase):
    def test_restore_retains_usable_skills_and_cad_without_arbitrary_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);data=root/'data'
            forge=SkillForge(data)
            skill=forge.propose({'name':'area','description':'Area','operation':'multiply','inputs':['a','b']},'general')
            forge.test('general',skill['id']);forge.activate('general',skill['id'])
            upgraded=forge.revise('general',skill['id'],{'name':'area','description':'Revised calculation','operation':'add','inputs':['a','b'],
                'tests':[{'parameters':{'a':5,'b':4},'expected':9}]})
            forge.test('general',upgraded['id']);forge.activate('general',upgraded['id'])
            cad=ParametricCAD(data)
            model=cad.create('general','Sample',[{'shape':'box','dimensions':{'width':10,'height':20,'length':5},'position':[0,0,0]}])
            (data/'skills'/'general'/'unsafe.py').write_text('raise RuntimeError()')
            archive=root/'backup.zip';export_backup(data,archive)
            with zipfile.ZipFile(archive) as stored:
                self.assertIn('skills/general/registry.json',stored.namelist())
                self.assertIn('parametric-cad/general/models.json',stored.namelist())
                self.assertNotIn('skills/general/unsafe.py',stored.namelist())
            target=root/'restored';restore_backup(archive,target)
            recovered=SkillForge(target)
            self.assertEqual(recovered.run('general','area',{'a':5,'b':4})['result'],9)
            recovered.rollback('general',upgraded['id'])
            self.assertEqual(recovered.run('general','area',{'a':5,'b':4})['result'],20)
            self.assertEqual(ParametricCAD(target).get('general',model['id'])['name'],'Sample')

